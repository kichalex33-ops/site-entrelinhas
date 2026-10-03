// Estudio Entrelinhas: API PRIVADA de obras e documentos (workspace de criacao).
// Regras de ouro: (1) todo acesso passa pelo dono da obra (users.id da sessao), nunca so pelo id recebido;
// (2) SALVAR nao e PUBLICAR: nada daqui aparece em perfil, biblioteca ou busca publica.
// Reaproveita helpers e autenticacao do index.js (recebidos em `h`).

const DOC_TYPES = ['capitulo', 'cena', 'personagem', 'lugar', 'objeto', 'evento', 'pesquisa', 'nota'];
const FOLDER_TYPES = ['pasta', 'manuscrito', 'personagens', 'mundo', 'pesquisa', 'ideias', 'descartadas'];
const KINDS = ['texto', 'hq', 'hibrida'];
const MANUAL_STATUS = ['rascunho', 'em_revisao', 'arquivado']; // os demais so pela publicacao
// body: 400 mil caracteres (~65 mil palavras) mantem cada salvamento dentro dos 10 ms de CPU do plano gratuito do Workers
const LIM = { works: 30, docs: 2000, body: 400000, title: 200, meta: 20000, request: 520000, tags: 20, links: 96 };
const ID_RE = /^[a-f0-9]{12}$/;
const SNAPSHOT_EVERY = 600; // segundos entre snapshots automaticos
const KEEP_VERSIONS = 50;

// pastas criadas junto com uma obra de texto/hibrida: [titulo, tipo]
const DEFAULT_FOLDERS = [
  ['Manuscrito', 'manuscrito'], ['Personagens', 'personagens'], ['Mundo', 'mundo'],
  ['Pesquisa', 'pesquisa'], ['Ideias', 'ideias'], ['Cenas descartadas', 'descartadas'],
];
const HQ_FOLDERS = [
  ['Roteiro', 'manuscrito'], ['Personagens', 'personagens'], ['Cenários', 'mundo'],
  ['Referências', 'pesquisa'], ['Notas', 'ideias'],
];

// ---------- indice derivado (busca, tags, links): sempre recalculado a partir do texto ----------
// minusculas e sem acento, para achar "marcia" em "Márcia"
export const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const HASHTAG_RE = /(?:^|[\s(>])\\?#([\p{L}][\p{L}\p{N}_-]{1,29})(?![\p{L}\p{N}_-])/gu;
const LINK_RE = /\\?\[\\?\[([^\[\]\n|\\]{1,120})(?:\|[^\[\]\n]*)?\\?\]\\?\]/g;
export const extractTags = (body) => [...new Set([...String(body || '').matchAll(HASHTAG_RE)].map((m) => m[1].toLowerCase()))].slice(0, LIM.tags * 2);
export const extractLinks = (body) => {
  const out = new Map();
  for (const m of String(body || '').matchAll(LINK_RE)) { const t = m[1].trim(); if (t && out.size < LIM.links) out.set(norm(t), t); }
  return [...out.entries()];
};

async function reindex(env, workId, docId, title, body) {
  // No plano gratuito cada consulta conta no limite por requisicao (50), entao o indice usa INSERTs de varias linhas:
  // no maximo ~6 comandos por salvamento, nao importa quantas tags e links o texto tenha. (D1: ate 100 parametros por comando.)
  const tags = extractTags(body).slice(0, LIM.tags);
  const links = extractLinks(body);
  const stmts = [
    env.DB.prepare('INSERT INTO studio_search (doc_id, work_id, norm_title, norm_body) VALUES (?, ?, ?, ?) ON CONFLICT(doc_id) DO UPDATE SET norm_title = excluded.norm_title, norm_body = excluded.norm_body')
      .bind(docId, workId, norm(title), norm(body)),
    env.DB.prepare("DELETE FROM studio_doc_tags WHERE doc_id = ? AND origem = 'texto'").bind(docId),
    env.DB.prepare('DELETE FROM studio_links WHERE from_doc = ?').bind(docId),
  ];
  if (tags.length) {
    stmts.push(env.DB.prepare('INSERT OR IGNORE INTO studio_doc_tags (doc_id, work_id, tag, origem) VALUES ' + tags.map(() => "(?, ?, ?, 'texto')").join(', '))
      .bind(...tags.flatMap((t) => [docId, workId, t])));
  }
  for (let i = 0; i < links.length; i += 24) {
    const lote = links.slice(i, i + 24);
    stmts.push(env.DB.prepare('INSERT OR IGNORE INTO studio_links (work_id, from_doc, to_norm, to_title) VALUES ' + lote.map(() => '(?, ?, ?, ?)').join(', '))
      .bind(...lote.flatMap(([n, t]) => [workId, docId, n, t])));
  }
  await env.DB.batch(stmts);
}

export const countWords = (t) => (String(t || '').match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) || []).length;

export async function studioApi(req, env, url, user, h) {
  const { json, fail } = h;
  if (user.role !== 'autor') return fail('Apenas autores usam o Estúdio.', 403);
  const ehUpload = req.method === 'POST' && /\/files\/?$/.test(url.pathname); // upload tem limite proprio (1,5 MB)
  if (!ehUpload && Number(req.headers.get('Content-Length') || 0) > LIM.request) return fail('Requisição grande demais.', 413);

  const parts = url.pathname.slice('/api/studio'.length).split('/').filter(Boolean);
  const m = req.method;
  const newId = () => h.toHex(h.rand(6));

  // ---------- obras ----------
  if (parts[0] !== 'works') return fail('Não encontrado.', 404);
  if (parts.length === 1) {
    if (m === 'GET') return listWorks(env, user, json);
    if (m === 'POST') return createWork(env, req, user, h, newId);
    return fail('Método não permitido.', 405);
  }

  const workId = parts[1];
  if (!ID_RE.test(workId)) return fail('Obra não encontrada.', 404);

  // restaurar uma obra enviada para a lixeira (precisa buscar incluindo deletadas)
  if (parts[2] === 'restore' && parts.length === 3 && m === 'POST') {
    const w = await env.DB.prepare('SELECT id FROM studio_works WHERE id = ? AND user_id = ? AND deleted_at IS NOT NULL').bind(workId, user.id).first();
    if (!w) return fail('Obra não encontrada.', 404);
    await env.DB.prepare('UPDATE studio_works SET deleted_at = NULL, updated_at = ? WHERE id = ?').bind(h.now(), workId).run();
    return json({ ok: true });
  }

  // a partir daqui a obra precisa existir, ser do usuario e nao estar excluida (404 se nao: nao revela existencia)
  const work = await env.DB.prepare('SELECT * FROM studio_works WHERE id = ? AND user_id = ? AND deleted_at IS NULL').bind(workId, user.id).first();
  if (!work) return fail('Obra não encontrada.', 404);

  if (parts.length === 2) {
    if (m === 'GET') return getWork(env, work, json);
    if (m === 'PATCH') return patchWork(env, req, work, h);
    if (m === 'DELETE') {
      await env.DB.prepare('UPDATE studio_works SET deleted_at = ?, updated_at = ? WHERE id = ?').bind(h.now(), h.now(), workId).run();
      return json({ ok: true });
    }
    return fail('Método não permitido.', 405);
  }

  if (parts[2] === 'search' && parts.length === 3 && m === 'GET') return searchDocs(env, work, url, json);

  // ---------- publicacao (copia publica, declaracao, agendamento) ----------
  if (parts[2] === 'publicacao' && parts.length === 3) {
    if (m === 'GET') return getPublicacao(env, work, user, h);
    if (env.ESTUDIO_PUBLICACAO !== 'on') return fail('A publicação ainda não está liberada no Entrelinhas.', 403);
    if (m === 'POST') return publicar(env, req, work, user, h);
    if (m === 'DELETE') return despublicar(env, work, h);
    return fail('Método não permitido.', 405);
  }

  if (parts[2] === 'trash' && parts.length === 3 && m === 'GET') {
    const rows = await env.DB.prepare(
      'SELECT id, parent_id, kind, doc_type, title, deleted_at FROM studio_docs WHERE work_id = ? AND deleted_at IS NOT NULL ORDER BY deleted_at DESC'
    ).bind(workId).all();
    return json({ itens: rows.results });
  }

  // ---------- arquivos originais (manuscritos importados), privados ----------
  if (parts[2] === 'files') {
    if (parts.length === 3 && m === 'GET') return listFiles(env, work, json);
    if (parts.length === 3 && m === 'POST') return uploadFile(env, req, url, work, h, newId);
    if (parts.length === 4 && ID_RE.test(parts[3])) {
      if (m === 'GET') return downloadFile(env, work, parts[3], fail);
      if (m === 'DELETE') { await env.DB.prepare('DELETE FROM studio_files WHERE id = ? AND work_id = ?').bind(parts[3], work.id).run(); return json({ ok: true }); }
    }
    return fail('Não encontrado.', 404);
  }

  // ---------- documentos ----------
  if (parts[2] !== 'docs') return fail('Não encontrado.', 404);
  if (parts.length === 3) {
    if (m === 'POST') return createDoc(env, req, work, h, newId);
    return fail('Método não permitido.', 405);
  }
  const docId = parts[3];
  if (!ID_RE.test(docId)) return fail('Documento não encontrado.', 404);
  const action = parts[4];
  if (parts.length === 4) {
    if (m === 'GET') return getDoc(env, work, docId, json, fail);
    if (m === 'PUT') return putDoc(env, req, work, docId, h);
    if (m === 'DELETE') {
      if (new URL(req.url).searchParams.get('definitivo') === '1') return purgeDoc(env, work, docId, h);
      return trashDoc(env, work, docId, h);
    }
    return fail('Método não permitido.', 405);
  }
  if (parts.length === 5 && m === 'POST') {
    if (action === 'move') return moveDoc(env, req, work, docId, h);
    if (action === 'duplicate') return duplicateDoc(env, work, docId, h, newId);
    if (action === 'restore') return restoreDoc(env, work, docId, h);
  }
  if (parts.length === 5 && action === 'tags' && m === 'PUT') return setTags(env, req, work, docId, h);
  if (parts.length === 5 && action === 'links' && m === 'GET') return getLinks(env, work, docId, json, fail);
  return fail('Não encontrado.', 404);
}

// ---------------------------------------------------------------- obras
async function listWorks(env, user, json) {
  const rows = await env.DB.prepare(
    'SELECT w.id, w.title, w.kind, w.status, w.scheduled_at, w.meta, w.created_at, w.updated_at, ' +
    "(SELECT COUNT(*) FROM studio_docs d WHERE d.work_id = w.id AND d.kind = 'doc' AND d.deleted_at IS NULL) AS docs, " +
    "(SELECT COALESCE(SUM(d.words), 0) FROM studio_docs d WHERE d.work_id = w.id AND d.kind = 'doc' AND d.deleted_at IS NULL AND d.doc_type IN ('capitulo', 'cena')) AS palavras " +
    'FROM studio_works w WHERE w.user_id = ? AND w.deleted_at IS NULL ORDER BY w.updated_at DESC'
  ).bind(user.id).all();
  return json({
    obras: rows.results.map((w) => {
      const meta = safeJson(w.meta);
      const meta_palavras = Number(meta.meta_palavras) || 0;
      return {
        id: w.id, titulo: w.title, tipo: w.kind, status: statusEfetivo(w, agora()), docs: w.docs, palavras: w.palavras,
        progresso: meta_palavras ? Math.min(1, w.palavras / meta_palavras) : null,
        criada_em: w.created_at, atualizada_em: w.updated_at,
      };
    }),
  });
}

async function createWork(env, req, user, h, newId) {
  const b = await h.body(req);
  if (!b) return h.fail('Requisição inválida.');
  const title = h.str(b.titulo, LIM.title);
  const kind = KINDS.includes(b.tipo) ? b.tipo : 'texto';
  if (!title) return h.fail('Dê um título à obra.');
  const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM studio_works WHERE user_id = ? AND deleted_at IS NULL').bind(user.id).first();
  if (n.n >= LIM.works) return h.fail('Limite de obras no Estúdio atingido.', 403);

  const id = newId(), t = h.now();
  const stmts = [env.DB.prepare('INSERT INTO studio_works (id, user_id, title, kind, status, meta, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, user.id, title, kind, 'rascunho', '{}', t, t)];
  (kind === 'hq' ? HQ_FOLDERS : DEFAULT_FOLDERS).forEach(([name, type], i) => {
    stmts.push(env.DB.prepare(
      "INSERT INTO studio_docs (id, work_id, parent_id, kind, doc_type, title, body, position, created_at, updated_at) VALUES (?, ?, NULL, 'pasta', ?, ?, '', ?, ?, ?)"
    ).bind(newId(), id, type, name, i + 1, t, t));
  });
  await env.DB.batch(stmts);
  return h.json({ ok: true, id }, 201);
}

async function getWork(env, work, json) {
  const rows = await env.DB.prepare(
    'SELECT id, parent_id, kind, doc_type, title, position, version, words, updated_at FROM studio_docs WHERE work_id = ? AND deleted_at IS NULL ORDER BY position, created_at'
  ).bind(work.id).all();
  const tg = await env.DB.prepare(
    'SELECT t.doc_id, t.tag FROM studio_doc_tags t JOIN studio_docs d ON d.id = t.doc_id WHERE t.work_id = ? AND d.deleted_at IS NULL ORDER BY t.tag'
  ).bind(work.id).all();
  const porDoc = new Map(), contagem = new Map();
  for (const r of tg.results) { if (!porDoc.has(r.doc_id)) porDoc.set(r.doc_id, []); porDoc.get(r.doc_id).push(r.tag); contagem.set(r.tag, (contagem.get(r.tag) || 0) + 1); }
  return json({
    obra: { id: work.id, titulo: work.title, tipo: work.kind, status: statusEfetivo(work, agora()), meta: safeJson(work.meta), atualizada_em: work.updated_at },
    itens: rows.results.map((d) => ({
      id: d.id, pai: d.parent_id, tipo: d.kind, doc_tipo: d.doc_type, titulo: d.title,
      posicao: d.position, versao: d.version, palavras: d.words, atualizado_em: d.updated_at, tags: porDoc.get(d.id) || [],
    })),
    tags: [...contagem.entries()].map(([tag, n]) => ({ tag, n })).sort((a, b) => b.n - a.n || a.tag.localeCompare(b.tag)),
  });
}

async function patchWork(env, req, work, h) {
  const b = await h.body(req);
  if (!b) return h.fail('Requisição inválida.');
  let title = work.title, status = work.status, meta = safeJson(work.meta);
  if (b.titulo !== undefined) { title = h.str(b.titulo, LIM.title); if (!title) return h.fail('O título não pode ficar vazio.'); }
  if (b.status !== undefined) {
    if (!MANUAL_STATUS.includes(b.status)) return h.fail('Esse status só muda pela publicação.', 400);
    if (['agendado', 'publicado', 'atualizado'].includes(work.status)) return h.fail('Obra publicada: use a tela de publicação.', 409);
    status = b.status;
  }
  if (b.meta && typeof b.meta === 'object') {
    const next = { ...meta };
    if (b.meta.sinopse !== undefined) next.sinopse = h.str(b.meta.sinopse, 3000);
    if (b.meta.genero !== undefined) next.genero = h.str(b.meta.genero, 80);
    if (b.meta.meta_palavras !== undefined) next.meta_palavras = Math.max(0, Math.min(5000000, parseInt(b.meta.meta_palavras, 10) || 0));
    if (JSON.stringify(next).length > LIM.meta) return h.fail('Informações da obra grandes demais.', 413);
    meta = next;
  }
  await env.DB.prepare('UPDATE studio_works SET title = ?, status = ?, meta = ?, updated_at = ? WHERE id = ?')
    .bind(title, status, JSON.stringify(meta), h.now(), work.id).run();
  return h.json({ ok: true });
}

// ---------------------------------------------------------------- documentos
async function parentOk(env, workId, parentId) {
  if (parentId === null || parentId === undefined || parentId === '') return null;
  if (!ID_RE.test(String(parentId))) return false;
  const p = await env.DB.prepare("SELECT id FROM studio_docs WHERE id = ? AND work_id = ? AND kind = 'pasta' AND deleted_at IS NULL").bind(parentId, workId).first();
  return p ? p.id : false;
}

async function nextPosition(env, workId, parentId) {
  const r = parentId
    ? await env.DB.prepare('SELECT COALESCE(MAX(position), 0) AS p FROM studio_docs WHERE work_id = ? AND parent_id = ?').bind(workId, parentId).first()
    : await env.DB.prepare('SELECT COALESCE(MAX(position), 0) AS p FROM studio_docs WHERE work_id = ? AND parent_id IS NULL').bind(workId).first();
  return r.p + 1;
}

async function createDoc(env, req, work, h, newId) {
  const b = await h.body(req);
  if (!b) return h.fail('Requisição inválida.');
  const kind = b.tipo === 'pasta' ? 'pasta' : 'doc';
  const type = kind === 'pasta' ? 'pasta' : DOC_TYPES.includes(b.doc_tipo) ? b.doc_tipo : 'nota';
  const title = h.str(b.titulo, LIM.title) || (kind === 'pasta' ? 'Nova pasta' : 'Sem título');
  const body = kind === 'pasta' ? '' : typeof b.corpo === 'string' ? b.corpo.slice(0, LIM.body) : '';
  const parent = await parentOk(env, work.id, b.pai);
  if (parent === false) return h.fail('Pasta de destino inválida.');
  const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM studio_docs WHERE work_id = ? AND deleted_at IS NULL').bind(work.id).first();
  if (n.n >= LIM.docs) return h.fail('Limite de documentos nesta obra atingido.', 403);

  const id = newId(), t = h.now(), pos = await nextPosition(env, work.id, parent);
  await env.DB.batch([
    env.DB.prepare('INSERT INTO studio_docs (id, work_id, parent_id, kind, doc_type, title, body, position, words, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, work.id, parent, kind, type, title, body, pos, countWords(body), t, t),
    env.DB.prepare('UPDATE studio_works SET updated_at = ? WHERE id = ?').bind(t, work.id),
  ]);
  if (kind === 'doc') await reindex(env, work.id, id, title, body);
  return h.json({ ok: true, id, posicao: pos, versao: 1 }, 201);
}

async function getDoc(env, work, docId, json, fail) {
  const d = await env.DB.prepare('SELECT * FROM studio_docs WHERE id = ? AND work_id = ? AND deleted_at IS NULL').bind(docId, work.id).first();
  if (!d) return fail('Documento não encontrado.', 404);
  return json({ id: d.id, pai: d.parent_id, tipo: d.kind, doc_tipo: d.doc_type, titulo: d.title, corpo: d.body, versao: d.version, palavras: d.words, atualizado_em: d.updated_at });
}

// Autosave com controle otimista: so grava se a versao base ainda e a atual; senao 409 (nunca sobrescreve em silencio).
async function putDoc(env, req, work, docId, h) {
  const b = await h.body(req);
  if (!b) return h.fail('Requisição inválida.');
  const base = Number(b.versao_base);
  if (!Number.isInteger(base) || base < 1) return h.fail('Informe a versão base do documento.');
  const cur = await env.DB.prepare('SELECT * FROM studio_docs WHERE id = ? AND work_id = ? AND deleted_at IS NULL').bind(docId, work.id).first();
  if (!cur) return h.fail('Documento não encontrado.', 404);

  const title = b.titulo === undefined ? cur.title : h.str(b.titulo, LIM.title) || cur.title;
  let body = cur.body;
  if (b.corpo !== undefined) {
    if (cur.kind === 'pasta') return h.fail('Pastas não têm texto.');
    if (typeof b.corpo !== 'string') return h.fail('Texto inválido.');
    if (b.corpo.length > LIM.body) return h.fail('O documento passou do tamanho máximo (400 mil caracteres). Divida em capítulos.', 413);
    body = b.corpo;
  }
  const type = b.doc_tipo === undefined ? cur.doc_type : cur.kind === 'pasta' ? cur.doc_type : DOC_TYPES.includes(b.doc_tipo) ? b.doc_tipo : cur.doc_type;

  const conflict = () => h.json({ erro: 'Este documento mudou em outro lugar.', atual: { versao: cur.version, titulo: cur.title, corpo: cur.body, atualizado_em: cur.updated_at } }, 409);
  if (cur.version !== base) return conflict();
  if (title === cur.title && body === cur.body && type === cur.doc_type) return h.json({ ok: true, versao: cur.version, palavras: cur.words, atualizado_em: cur.updated_at, semMudanca: true });

  const t = h.now(), words = countWords(body);
  const res = await env.DB.prepare(
    'UPDATE studio_docs SET title = ?, body = ?, doc_type = ?, words = ?, version = version + 1, updated_at = ? WHERE id = ? AND work_id = ? AND version = ? AND deleted_at IS NULL'
  ).bind(title, body, type, words, t, docId, work.id, base).run();
  if (!res.meta || res.meta.changes !== 1) return conflict(); // alguem salvou entre a leitura e a escrita
  await env.DB.prepare('UPDATE studio_works SET updated_at = ? WHERE id = ?').bind(t, work.id).run();

  if (cur.kind === 'doc' && (body !== cur.body || title !== cur.title)) await reindex(env, work.id, docId, title, body);
  if (cur.kind === 'doc' && body !== cur.body) await maybeSnapshot(env, docId, work.id, title, body, t);
  return h.json({ ok: true, versao: base + 1, palavras: words, atualizado_em: t });
}

async function maybeSnapshot(env, docId, workId, title, body, t, reason = 'auto', force = false) {
  if (!force) {
    const last = await env.DB.prepare('SELECT MAX(created_at) AS t FROM studio_versions WHERE doc_id = ?').bind(docId).first();
    if (last && last.t && t - last.t < SNAPSHOT_EVERY) return;
  }
  await env.DB.prepare('INSERT INTO studio_versions (doc_id, work_id, title, body, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(docId, workId, title, body, reason, t).run();
  await env.DB.prepare('DELETE FROM studio_versions WHERE doc_id = ? AND id NOT IN (SELECT id FROM studio_versions WHERE doc_id = ? ORDER BY id DESC LIMIT ?)').bind(docId, docId, KEEP_VERSIONS).run();
}

// ids da subarvore (a propria pasta/doc + descendentes), calculado em memoria sobre os itens da obra
async function subtree(env, workId, rootId, onlyAlive) {
  const rows = await env.DB.prepare(
    onlyAlive ? 'SELECT id, parent_id FROM studio_docs WHERE work_id = ? AND deleted_at IS NULL' : 'SELECT id, parent_id FROM studio_docs WHERE work_id = ?'
  ).bind(workId).all();
  const kids = new Map();
  for (const r of rows.results) { if (!kids.has(r.parent_id)) kids.set(r.parent_id, []); kids.get(r.parent_id).push(r.id); }
  const out = [], stack = [rootId];
  while (stack.length) { const id = stack.pop(); out.push(id); for (const k of kids.get(id) || []) stack.push(k); }
  return out;
}

async function trashDoc(env, work, docId, h) {
  const d = await env.DB.prepare('SELECT id, kind, title, body FROM studio_docs WHERE id = ? AND work_id = ? AND deleted_at IS NULL').bind(docId, work.id).first();
  if (!d) return h.fail('Documento não encontrado.', 404);
  const t = h.now();
  const ids = await subtree(env, work.id, docId, true);
  if (d.kind === 'doc') await maybeSnapshot(env, docId, work.id, d.title, d.body, t, 'exclusao', true); // rede de seguranca antes de enviar para a lixeira
  for (let i = 0; i < ids.length; i += 50) {
    const lote = ids.slice(i, i + 50);
    await env.DB.prepare(`UPDATE studio_docs SET deleted_at = ? WHERE work_id = ? AND id IN (${lote.map(() => '?').join(',')})`).bind(t, work.id, ...lote).run();
  }
  await env.DB.prepare('UPDATE studio_works SET updated_at = ? WHERE id = ?').bind(t, work.id).run();
  return h.json({ ok: true, enviados: ids.length });
}

async function restoreDoc(env, work, docId, h) {
  const d = await env.DB.prepare('SELECT id, parent_id, deleted_at FROM studio_docs WHERE id = ? AND work_id = ? AND deleted_at IS NOT NULL').bind(docId, work.id).first();
  if (!d) return h.fail('Documento não encontrado na lixeira.', 404);
  const ids = (await subtree(env, work.id, docId, false));
  // restaura so o que foi para a lixeira junto com este item (mesmo carimbo)
  for (let i = 0; i < ids.length; i += 50) {
    const lote = ids.slice(i, i + 50);
    await env.DB.prepare(`UPDATE studio_docs SET deleted_at = NULL WHERE work_id = ? AND deleted_at = ? AND id IN (${lote.map(() => '?').join(',')})`).bind(work.id, d.deleted_at, ...lote).run();
  }
  // se a pasta de origem tambem esta na lixeira (ou sumiu), volta para a raiz
  const pai = d.parent_id ? await env.DB.prepare('SELECT id FROM studio_docs WHERE id = ? AND work_id = ? AND deleted_at IS NULL').bind(d.parent_id, work.id).first() : null;
  if (d.parent_id && !pai) await env.DB.prepare('UPDATE studio_docs SET parent_id = NULL WHERE id = ?').bind(docId).run();
  await env.DB.prepare('UPDATE studio_works SET updated_at = ? WHERE id = ?').bind(h.now(), work.id).run();
  return h.json({ ok: true });
}

async function purgeDoc(env, work, docId, h) {
  const d = await env.DB.prepare('SELECT id FROM studio_docs WHERE id = ? AND work_id = ? AND deleted_at IS NOT NULL').bind(docId, work.id).first();
  if (!d) return h.fail('Só itens que estão na lixeira podem ser apagados definitivamente.', 409);
  const ids = await subtree(env, work.id, docId, false);
  for (let i = 0; i < ids.length; i += 50) {
    const lote = ids.slice(i, i + 50);
    await env.DB.prepare(`DELETE FROM studio_docs WHERE work_id = ? AND id IN (${lote.map(() => '?').join(',')})`).bind(work.id, ...lote).run();
  }
  return h.json({ ok: true, apagados: ids.length });
}

async function moveDoc(env, req, work, docId, h) {
  const b = await h.body(req);
  if (!b) return h.fail('Requisição inválida.');
  const d = await env.DB.prepare('SELECT id FROM studio_docs WHERE id = ? AND work_id = ? AND deleted_at IS NULL').bind(docId, work.id).first();
  if (!d) return h.fail('Documento não encontrado.', 404);
  const parent = await parentOk(env, work.id, b.pai);
  if (parent === false) return h.fail('Pasta de destino inválida.');
  if (parent) { // nao mover uma pasta para dentro dela mesma ou de um descendente
    const sub = await subtree(env, work.id, docId, true);
    if (sub.includes(parent)) return h.fail('Não dá para mover uma pasta para dentro dela mesma.', 400);
  }
  const pos = Number.isFinite(Number(b.posicao)) ? Number(b.posicao) : await nextPosition(env, work.id, parent);
  await env.DB.prepare('UPDATE studio_docs SET parent_id = ?, position = ? WHERE id = ? AND work_id = ?').bind(parent, pos, docId, work.id).run();
  await env.DB.prepare('UPDATE studio_works SET updated_at = ? WHERE id = ?').bind(h.now(), work.id).run();
  return h.json({ ok: true, posicao: pos });
}

async function duplicateDoc(env, work, docId, h, newId) {
  const d = await env.DB.prepare('SELECT * FROM studio_docs WHERE id = ? AND work_id = ? AND deleted_at IS NULL').bind(docId, work.id).first();
  if (!d) return h.fail('Documento não encontrado.', 404);
  if (d.kind === 'pasta') return h.fail('Por enquanto só documentos podem ser duplicados.', 400);
  const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM studio_docs WHERE work_id = ? AND deleted_at IS NULL').bind(work.id).first();
  if (n.n >= LIM.docs) return h.fail('Limite de documentos nesta obra atingido.', 403);
  const next = d.parent_id
    ? await env.DB.prepare('SELECT MIN(position) AS p FROM studio_docs WHERE work_id = ? AND parent_id = ? AND position > ? AND deleted_at IS NULL').bind(work.id, d.parent_id, d.position).first()
    : await env.DB.prepare('SELECT MIN(position) AS p FROM studio_docs WHERE work_id = ? AND parent_id IS NULL AND position > ? AND deleted_at IS NULL').bind(work.id, d.position).first();
  const pos = next && next.p !== null ? (d.position + next.p) / 2 : d.position + 1;
  const id = newId(), t = h.now(), title = (d.title + ' (cópia)').slice(0, LIM.title);
  await env.DB.prepare('INSERT INTO studio_docs (id, work_id, parent_id, kind, doc_type, title, body, position, words, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, work.id, d.parent_id, d.kind, d.doc_type, title, d.body, pos, d.words, t, t).run();
  await reindex(env, work.id, id, title, d.body);
  await env.DB.prepare("INSERT OR IGNORE INTO studio_doc_tags (doc_id, work_id, tag, origem) SELECT ?, work_id, tag, origem FROM studio_doc_tags WHERE doc_id = ? AND origem = 'manual'").bind(id, docId).run();
  await env.DB.prepare('UPDATE studio_works SET updated_at = ? WHERE id = ?').bind(t, work.id).run();
  return h.json({ ok: true, id, posicao: pos, versao: 1 }, 201);
}

// ---------------------------------------------------------------- arquivos originais
const FILE_TYPES = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain; charset=utf-8', md: 'text/markdown; charset=utf-8', markdown: 'text/markdown; charset=utf-8',
};
const LIM_FILE = 1500000, LIM_FILES = 5; // limite de linha do D1 = 2 MB

const nomeSeguro = (n) => String(n || 'manuscrito').replace(/[\u0000-\u001f\\/:*?"<>|]/g, '_').replace(/^\.+/, '').trim().slice(0, 120) || 'manuscrito';

async function listFiles(env, work, json) {
  const r = await env.DB.prepare('SELECT id, name, mime, size, created_at FROM studio_files WHERE work_id = ? ORDER BY created_at DESC').bind(work.id).all();
  return json({ arquivos: r.results.map((f) => ({ id: f.id, nome: f.name, tamanho: f.size, criado_em: f.created_at })) });
}

async function uploadFile(env, req, url, work, h, newId) {
  const nome = nomeSeguro(url.searchParams.get('nome'));
  const ext = (nome.match(/\.([a-z0-9]+)$/i) || [])[1];
  const mime = ext && FILE_TYPES[ext.toLowerCase()];
  if (!mime) return h.fail('Formato não aceito. Use DOCX, TXT ou Markdown.', 400);
  if (Number(req.headers.get('Content-Length') || 0) > LIM_FILE) return h.fail('O arquivo passou de 1,5 MB: a importação funciona, mas o original não pode ser guardado.', 413);
  const buf = new Uint8Array(await req.arrayBuffer());
  if (!buf.length) return h.fail('Arquivo vazio.');
  if (buf.length > LIM_FILE) return h.fail('O arquivo passou de 1,5 MB: a importação funciona, mas o original não pode ser guardado.', 413);
  const ehDocx = ext.toLowerCase() === 'docx';
  if (ehDocx ? !(buf[0] === 0x50 && buf[1] === 0x4b) : buf.subarray(0, 2000).includes(0)) return h.fail('O conteúdo do arquivo não corresponde ao formato.', 400);
  const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM studio_files WHERE work_id = ?').bind(work.id).first();
  if (n.n >= LIM_FILES) return h.fail('Esta obra já guarda ' + LIM_FILES + ' arquivos originais. Apague algum para guardar outro.', 403);
  const id = newId();
  await env.DB.prepare('INSERT INTO studio_files (id, work_id, name, mime, size, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(id, work.id, nome, mime, buf.length, buf.buffer, h.now()).run(); // ArrayBuffer, como o upload de imagens
  return h.json({ ok: true, id, nome, tamanho: buf.length }, 201);
}

async function downloadFile(env, work, fileId, fail) {
  const f = await env.DB.prepare('SELECT name, mime, data FROM studio_files WHERE id = ? AND work_id = ?').bind(fileId, work.id).first();
  if (!f) return fail('Arquivo não encontrado.', 404);
  const bytes = f.data instanceof ArrayBuffer ? new Uint8Array(f.data) : new Uint8Array(f.data); // o D1 devolve BLOB como lista de numeros
  return new Response(bytes, {
    headers: {
      'Content-Type': f.mime,
      'Content-Disposition': "attachment; filename*=UTF-8''" + encodeURIComponent(f.name),
      'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store', 'Content-Security-Policy': "default-src 'none'; sandbox",
    },
  });
}

// ---------------------------------------------------------------- links internos [[...]]
// "saem": links escritos neste documento (com o destino, se existir); "entram": documentos que citam este (backlinks).
// A resolucao e por titulo normalizado, entao criar, renomear ou restaurar o destino conserta o link sozinho.
async function getLinks(env, work, docId, json, fail) {
  const d = await env.DB.prepare("SELECT id, title FROM studio_docs WHERE id = ? AND work_id = ? AND kind = 'doc' AND deleted_at IS NULL").bind(docId, work.id).first();
  if (!d) return fail('Documento não encontrado.', 404);
  const saem = await env.DB.prepare(
    'SELECT l.to_title, l.to_norm, d2.id AS did, d2.title AS dtitle, d2.doc_type AS dtipo FROM studio_links l ' +
    'LEFT JOIN studio_search s2 ON s2.work_id = l.work_id AND s2.norm_title = l.to_norm ' +
    "LEFT JOIN studio_docs d2 ON d2.id = s2.doc_id AND d2.deleted_at IS NULL AND d2.kind = 'doc' " +
    'WHERE l.from_doc = ? AND l.work_id = ? ORDER BY l.to_title, d2.updated_at DESC'
  ).bind(docId, work.id).all();
  const vistos = new Set(), listaSaem = [];
  for (const r of saem.results) {
    if (vistos.has(r.to_norm)) continue; // titulo repetido na obra: usa o mais recente
    vistos.add(r.to_norm);
    listaSaem.push({ titulo: r.to_title, destino: r.did && r.did !== docId ? { id: r.did, titulo: r.dtitle, doc_tipo: r.dtipo } : r.did ? { id: r.did, titulo: r.dtitle, doc_tipo: r.dtipo, proprio: true } : null });
  }
  const entram = await env.DB.prepare(
    'SELECT d3.id, d3.title, d3.doc_type FROM studio_links l ' +
    "JOIN studio_docs d3 ON d3.id = l.from_doc AND d3.deleted_at IS NULL AND d3.work_id = l.work_id " +
    'WHERE l.work_id = ? AND l.from_doc != ? AND l.to_norm = (SELECT norm_title FROM studio_search WHERE doc_id = ?) ORDER BY d3.title'
  ).bind(work.id, docId, docId).all();
  return json({ saem: listaSaem, entram: entram.results.map((r) => ({ id: r.id, titulo: r.title, doc_tipo: r.doc_type })) });
}

// ---------------------------------------------------------------- tags e busca
const TAG_RE = /^[\p{L}\p{N}][\p{L}\p{N}_-]{0,29}$/u;
async function setTags(env, req, work, docId, h) {
  const b = await h.body(req);
  if (!b || !Array.isArray(b.tags)) return h.fail('Informe a lista de tags.');
  const d = await env.DB.prepare("SELECT id FROM studio_docs WHERE id = ? AND work_id = ? AND kind = 'doc' AND deleted_at IS NULL").bind(docId, work.id).first();
  if (!d) return h.fail('Documento não encontrado.', 404);
  const tags = [...new Set(b.tags.map((t) => h.str(t, 31).replace(/^#/, '').toLowerCase()).filter(Boolean))];
  if (tags.length > LIM.tags) return h.fail('No máximo ' + LIM.tags + ' tags por documento.');
  const ruim = tags.find((t) => !TAG_RE.test(t));
  if (ruim) return h.fail('Tag inválida: “' + ruim + '”. Use letras, números, hífen ou sublinhado (até 30).');
  await env.DB.batch([
    env.DB.prepare("DELETE FROM studio_doc_tags WHERE doc_id = ? AND origem = 'manual'").bind(docId),
    ...tags.map((t) => env.DB.prepare("INSERT OR IGNORE INTO studio_doc_tags (doc_id, work_id, tag, origem) VALUES (?, ?, ?, 'manual')").bind(docId, work.id, t)),
  ]);
  const todas = await env.DB.prepare('SELECT tag FROM studio_doc_tags WHERE doc_id = ? ORDER BY tag').bind(docId).all();
  return h.json({ ok: true, tags: todas.results.map((r) => r.tag) });
}

// busca no titulo e no texto (sem acento, sem diferenca de caixa), so dentro da obra do dono, so documentos vivos
async function searchDocs(env, work, url, json) {
  const q = norm(url.searchParams.get('q') || '').trim().slice(0, 100);
  const tag = (url.searchParams.get('tag') || '').toLowerCase().slice(0, 30);
  const tipo = DOC_TYPES.includes(url.searchParams.get('tipo')) ? url.searchParams.get('tipo') : '';
  const comTexto = q.length >= 2;
  if (!comTexto && !tag && !tipo) return json({ resultados: [] });
  const like = '%' + q.replace(/[\\%_]/g, '\\$&') + '%';
  const filtros = [], args = [];
  if (comTexto) { filtros.push("(s.norm_title LIKE ? ESCAPE '\\' OR s.norm_body LIKE ? ESCAPE '\\')"); args.push(like, like); }
  if (tag) { filtros.push('EXISTS (SELECT 1 FROM studio_doc_tags t WHERE t.doc_id = d.id AND t.tag = ?)'); args.push(tag); }
  if (tipo) { filtros.push('d.doc_type = ?'); args.push(tipo); }
  const cols = comTexto
    ? "(s.norm_title LIKE ? ESCAPE '\\') AS no_titulo, CASE WHEN s.norm_body LIKE ? ESCAPE '\\' THEN substr(d.body, max(1, instr(s.norm_body, ?) - 50), 170) ELSE NULL END AS trecho"
    : '0 AS no_titulo, NULL AS trecho';
  const rows = await env.DB.prepare(
    'SELECT d.id, d.parent_id, d.doc_type, d.title, d.updated_at, ' + cols +
    " FROM studio_docs d JOIN studio_search s ON s.doc_id = d.id WHERE d.work_id = ? AND d.deleted_at IS NULL AND d.kind = 'doc' AND " +
    filtros.join(' AND ') + ' ORDER BY no_titulo DESC, d.updated_at DESC LIMIT 40'
  ).bind(...(comTexto ? [like, like, q] : []), work.id, ...args).all();
  return json({
    resultados: rows.results.map((r) => ({ id: r.id, pai: r.parent_id, doc_tipo: r.doc_type, titulo: r.title, no_titulo: !!r.no_titulo, trecho: r.trecho, atualizado_em: r.updated_at })),
  });
}

// ---------------------------------------------------------------- publicacao
// SALVAR nao e PUBLICAR: publicar tira uma copia (studio_pub_docs) dos capitulos escolhidos; o leitor so ve essa copia.
// Editar o rascunho depois nao muda nada no ar ate o autor "atualizar a publicacao".
const agora = () => Math.floor(Date.now() / 1000);
const PUBLICAS = ['publicado', 'atualizado'];
const LIM_PUB = { caps: 500, sinopse: 3000, genero: 80, creditos: 500, agendaMax: 366 * 86400 };
const IMG_ID_RE = /^[a-f0-9]{24}$/;

// agendada cuja hora ja chegou conta como publicada (o banco so muda quando o autor mexe de novo)
export const statusEfetivo = (w, t) => (w.status === 'agendado' && w.scheduled_at && w.scheduled_at <= t ? 'publicado' : w.status);

const slugObra = (s) => norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '') || 'obra';
async function slugLivre(env, userId, workId, titulo) {
  const base = slugObra(titulo);
  const r = await env.DB.prepare("SELECT pub_slug FROM studio_works WHERE user_id = ? AND id != ? AND pub_slug IS NOT NULL AND (pub_slug = ? OR pub_slug LIKE ? ESCAPE '\\')")
    .bind(userId, workId, base, base.replace(/[\\%_]/g, '\\$&') + '-%').all();
  const usados = new Set(r.results.map((x) => x.pub_slug));
  let slug = base;
  for (let i = 2; usados.has(slug); i++) slug = `${base.slice(0, 55)}-${i}`;
  return slug;
}

async function declaracaoAtual(env) {
  return env.DB.prepare('SELECT versao, texto, provisorio FROM studio_declarations ORDER BY versao DESC LIMIT 1').first();
}

async function getPublicacao(env, work, user, h) {
  const t = h.now();
  const dec = await declaracaoAtual(env);
  const caps = await env.DB.prepare('SELECT ordem, doc_id, titulo, palavras FROM studio_pub_docs WHERE work_id = ? ORDER BY ordem').bind(work.id).all();
  const meta = safeJson(work.meta), pub = safeJson(work.pub_meta);
  return h.json({
    ligada: env.ESTUDIO_PUBLICACAO === 'on',
    declaracao: dec ? { versao: dec.versao, texto: dec.texto, provisoria: !!dec.provisorio } : null,
    status: statusEfetivo(work, t),
    no_ar: PUBLICAS.includes(statusEfetivo(work, t)),
    slug: work.pub_slug, versao: work.pub_version, publicada_em: work.published_at, agendada_para: work.status === 'agendado' ? work.scheduled_at : null,
    autor: user.slug,
    // o que ja esta publicado (ou, na primeira vez, o que vem das informacoes da obra)
    meta: {
      titulo: pub.titulo || work.title, genero: pub.genero ?? meta.genero ?? '', sinopse: pub.sinopse ?? meta.sinopse ?? '',
      creditos: pub.creditos || '', capa: pub.capa || meta.capa || '',
    },
    capitulos: caps.results.map((c) => ({ n: c.ordem, doc_id: c.doc_id, titulo: c.titulo, palavras: c.palavras })),
  });
}

async function publicar(env, req, work, user, h) {
  const b = await h.body(req);
  if (!b) return h.fail('Requisição inválida.');
  const t = h.now();
  const acao = b.acao === 'agendar' ? 'agendar' : 'publicar';

  // declaracao: o aceite precisa ser da versao em vigor
  const dec = await declaracaoAtual(env);
  if (!dec) return h.fail('A declaração de autoria não está disponível.', 503);
  if (b.aceite !== dec.versao) return h.fail('Leia e aceite a declaração de autoria para publicar.', 400);

  // metadados publicos
  const m = b.meta && typeof b.meta === 'object' ? b.meta : {};
  const meta = {
    titulo: h.str(m.titulo, LIM.title), genero: h.str(m.genero, LIM_PUB.genero),
    sinopse: h.str(m.sinopse, LIM_PUB.sinopse), creditos: h.str(m.creditos, LIM_PUB.creditos), capa: '',
  };
  if (!meta.titulo) return h.fail('Dê um título à obra publicada.');
  if (!meta.sinopse) return h.fail('Escreva uma sinopse: é ela que apresenta a obra ao leitor.');
  if (m.capa) {
    if (!IMG_ID_RE.test(String(m.capa))) return h.fail('Capa inválida.');
    const img = await env.DB.prepare('SELECT 1 FROM images WHERE id = ? AND user_id = ?').bind(m.capa, user.id).first();
    if (!img) return h.fail('Capa inválida.');
    meta.capa = m.capa;
  }

  // capitulos: ids da propria obra, documentos vivos, sem repeticao, na ordem enviada
  const ids = Array.isArray(b.docs) ? b.docs.map(String) : [];
  if (!ids.length) return h.fail('Escolha pelo menos um capítulo para publicar.');
  if (ids.length > LIM_PUB.caps) return h.fail('No máximo ' + LIM_PUB.caps + ' capítulos por obra.');
  if (new Set(ids).size !== ids.length || ids.some((id) => !ID_RE.test(id))) return h.fail('Lista de capítulos inválida.');
  const vivos = await env.DB.prepare("SELECT id FROM studio_docs WHERE work_id = ? AND kind = 'doc' AND deleted_at IS NULL").bind(work.id).all();
  const ok = new Set(vivos.results.map((r) => r.id));
  if (ids.some((id) => !ok.has(id))) return h.fail('Algum capítulo escolhido não existe mais nesta obra. Recarregue e tente de novo.', 409);

  // agendamento
  const visivel = PUBLICAS.includes(statusEfetivo(work, t));
  let status, scheduled = null, publishedAt = work.published_at;
  if (acao === 'agendar') {
    if (visivel) return h.fail('A obra já está no ar: atualize a publicação em vez de agendar.', 409);
    const quando = Number(b.quando);
    if (!Number.isInteger(quando) || quando < t + 60) return h.fail('Escolha uma data e hora no futuro.');
    if (quando > t + LIM_PUB.agendaMax) return h.fail('O agendamento pode ser de no máximo um ano.');
    status = 'agendado'; scheduled = quando; publishedAt = quando;
  } else {
    status = visivel || work.pub_version > 0 ? 'atualizado' : 'publicado';
    if (!visivel) publishedAt = t; // (re)entra no ar agora
  }

  const slug = work.pub_slug || (await slugLivre(env, user.id, work.id, meta.titulo));
  const versao = work.pub_version + 1;
  // copia feita no proprio banco (INSERT ... SELECT): o texto nao passa pelo Worker, e cabe nos 10 ms de CPU.
  // ate 48 capitulos por comando (D1: 100 parametros), entao ~11 comandos no maximo, numa transacao so (batch).
  const stmts = [
    env.DB.prepare('DELETE FROM studio_pub_docs WHERE work_id = ?').bind(work.id),
  ];
  for (let i = 0; i < ids.length; i += 48) {
    const lote = ids.slice(i, i + 48);
    stmts.push(env.DB.prepare(
      `WITH escolha(ordem, id) AS (VALUES ${lote.map(() => '(?, ?)').join(', ')}) ` +
      'INSERT INTO studio_pub_docs (work_id, ordem, doc_id, titulo, corpo, palavras) ' +
      "SELECT d.work_id, escolha.ordem, d.id, d.title, d.body, d.words FROM escolha JOIN studio_docs d ON d.id = escolha.id AND d.work_id = ? AND d.kind = 'doc' AND d.deleted_at IS NULL"
    ).bind(...lote.flatMap((id, k) => [i + k + 1, id]), work.id));
  }
  stmts.push(
    env.DB.prepare('UPDATE studio_works SET status = ?, pub_slug = ?, pub_version = ?, pub_meta = ?, published_at = ?, scheduled_at = ?, updated_at = ? WHERE id = ? AND user_id = ?')
      .bind(status, slug, versao, JSON.stringify(meta), publishedAt, scheduled, t, work.id, user.id),
    env.DB.prepare('INSERT INTO studio_acceptances (work_id, user_id, declaration_version, acao, pub_version, accepted_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(work.id, user.id, dec.versao, acao === 'agendar' ? 'agendar' : status === 'atualizado' ? 'atualizar' : 'publicar', versao, t),
  );
  await env.DB.batch(stmts);
  return h.json({
    ok: true, status, slug, versao, capitulos: ids.length, agendada_para: scheduled,
    url: `ler.html?a=${encodeURIComponent(user.slug)}&o=${encodeURIComponent(slug)}`,
  });
}

// tira do ar (ou cancela o agendamento). O endereco (slug) fica reservado para quando voltar.
async function despublicar(env, work, h) {
  if (!['agendado', ...PUBLICAS].includes(work.status)) return h.fail('Esta obra não está publicada.', 409);
  const t = h.now();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM studio_pub_docs WHERE work_id = ?').bind(work.id),
    env.DB.prepare("UPDATE studio_works SET status = 'em_revisao', scheduled_at = NULL, updated_at = ? WHERE id = ?").bind(t, work.id),
  ]);
  return h.json({ ok: true, status: 'em_revisao' });
}

function safeJson(s) { try { const o = JSON.parse(s); return o && typeof o === 'object' ? o : {}; } catch { return {}; } }
