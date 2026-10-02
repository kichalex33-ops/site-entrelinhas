// Estudio Entrelinhas: API PRIVADA de obras e documentos (workspace de criacao).
// Regras de ouro: (1) todo acesso passa pelo dono da obra (users.id da sessao), nunca so pelo id recebido;
// (2) SALVAR nao e PUBLICAR: nada daqui aparece em perfil, biblioteca ou busca publica.
// Reaproveita helpers e autenticacao do index.js (recebidos em `h`).

const DOC_TYPES = ['capitulo', 'cena', 'personagem', 'lugar', 'objeto', 'evento', 'pesquisa', 'nota'];
const FOLDER_TYPES = ['pasta', 'manuscrito', 'personagens', 'mundo', 'pesquisa', 'ideias', 'descartadas'];
const KINDS = ['texto', 'hq', 'hibrida'];
const MANUAL_STATUS = ['rascunho', 'em_revisao', 'arquivado']; // os demais so pela publicacao
// body: 400 mil caracteres (~65 mil palavras) mantem cada salvamento dentro dos 10 ms de CPU do plano gratuito do Workers
const LIM = { works: 30, docs: 2000, body: 400000, title: 200, meta: 20000, request: 520000, tags: 20, links: 100 };
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
  const stmts = [
    env.DB.prepare('INSERT INTO studio_search (doc_id, work_id, norm_title, norm_body) VALUES (?, ?, ?, ?) ON CONFLICT(doc_id) DO UPDATE SET norm_title = excluded.norm_title, norm_body = excluded.norm_body')
      .bind(docId, workId, norm(title), norm(body)),
    env.DB.prepare("DELETE FROM studio_doc_tags WHERE doc_id = ? AND origem = 'texto'").bind(docId),
    ...extractTags(body).map((t) => env.DB.prepare("INSERT OR IGNORE INTO studio_doc_tags (doc_id, work_id, tag, origem) VALUES (?, ?, ?, 'texto')").bind(docId, workId, t)),
    env.DB.prepare('DELETE FROM studio_links WHERE from_doc = ?').bind(docId),
    ...extractLinks(body).map(([n, t]) => env.DB.prepare('INSERT OR IGNORE INTO studio_links (work_id, from_doc, to_norm, to_title) VALUES (?, ?, ?, ?)').bind(workId, docId, n, t)),
  ];
  await env.DB.batch(stmts);
}

export const countWords = (t) => (String(t || '').match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) || []).length;

export async function studioApi(req, env, url, user, h) {
  const { json, fail } = h;
  if (user.role !== 'autor') return fail('Apenas autores usam o Estúdio.', 403);
  if (Number(req.headers.get('Content-Length') || 0) > LIM.request) return fail('Requisição grande demais.', 413);

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

  if (parts[2] === 'trash' && parts.length === 3 && m === 'GET') {
    const rows = await env.DB.prepare(
      'SELECT id, parent_id, kind, doc_type, title, deleted_at FROM studio_docs WHERE work_id = ? AND deleted_at IS NOT NULL ORDER BY deleted_at DESC'
    ).bind(workId).all();
    return json({ itens: rows.results });
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
    'SELECT w.id, w.title, w.kind, w.status, w.meta, w.created_at, w.updated_at, ' +
    "(SELECT COUNT(*) FROM studio_docs d WHERE d.work_id = w.id AND d.kind = 'doc' AND d.deleted_at IS NULL) AS docs, " +
    "(SELECT COALESCE(SUM(d.words), 0) FROM studio_docs d WHERE d.work_id = w.id AND d.kind = 'doc' AND d.deleted_at IS NULL AND d.doc_type IN ('capitulo', 'cena')) AS palavras " +
    'FROM studio_works w WHERE w.user_id = ? AND w.deleted_at IS NULL ORDER BY w.updated_at DESC'
  ).bind(user.id).all();
  return json({
    obras: rows.results.map((w) => {
      const meta = safeJson(w.meta);
      const meta_palavras = Number(meta.meta_palavras) || 0;
      return {
        id: w.id, titulo: w.title, tipo: w.kind, status: w.status, docs: w.docs, palavras: w.palavras,
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
    obra: { id: work.id, titulo: work.title, tipo: work.kind, status: work.status, meta: safeJson(work.meta), atualizada_em: work.updated_at },
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

function safeJson(s) { try { const o = JSON.parse(s); return o && typeof o === 'object' ? o : {}; } catch { return {}; } }
