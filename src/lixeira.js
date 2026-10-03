// Lixeira de livros (lixeira.html, so o autor ve): livros removidos do perfil e obras excluidas no Estudio.
// Nada se perde ao remover: avaliacoes, favoritos, pagina do livro e extras ficam ligados ao id da obra
// e voltam ao restaurar. So "Excluir definitivamente" apaga de vez.
// Depois de PRAZO_DIAS na lixeira o livro e excluido de vez (tarefa diaria: scheduled em src/index.js).
export const PRAZO_DIAS = 15;
const ID_RE = /^[a-f0-9]{12}$/;
const MAX_OBRAS_PERFIL = 20; // mesmo limite de sanitizeProfile
const safe = (s) => { try { const o = JSON.parse(s); return o && typeof o === 'object' ? o : {}; } catch { return {}; } };

// chamado ao salvar o perfil: o que saiu vai para a lixeira; o que voltou sai dela
export function movimentosDaLixeira(env, userId, antes, depois, t) {
  const ficam = new Set(depois.map((o) => o.id));
  const st = [];
  for (const o of antes) {
    if (o.id && !ficam.has(o.id)) {
      st.push(env.DB.prepare('INSERT INTO book_trash (obra_id, user_id, data, removed_at) VALUES (?, ?, ?, ?) ON CONFLICT(obra_id) DO UPDATE SET data = excluded.data, removed_at = excluded.removed_at WHERE book_trash.user_id = excluded.user_id')
        .bind(o.id, userId, JSON.stringify(o), t));
    }
  }
  for (const id of ficam) st.push(env.DB.prepare('DELETE FROM book_trash WHERE obra_id = ? AND user_id = ?').bind(id, userId));
  return st;
}

// capas e ids dos livros na lixeira (a limpeza de imagens e o apagar conta precisam conhecer)
export async function naLixeira(env, userId) {
  const r = await env.DB.prepare('SELECT obra_id, data FROM book_trash WHERE user_id = ?').bind(userId).all();
  return r.results.map((x) => ({ id: x.obra_id, capa: safe(x.data).capa || '' }));
}

// tudo que leitores e o autor deixaram em volta da obra (so na exclusao definitiva)
function rastros(env, slug, obraId) {
  const st = (sql, ...a) => env.DB.prepare(sql).bind(...a);
  return [
    st('DELETE FROM reviews WHERE author_slug = ? AND obra_id = ?', slug, obraId),
    st('DELETE FROM book_favorites WHERE obra_id = ?', obraId),
    st('DELETE FROM book_views WHERE obra_id = ?', obraId),
    st('DELETE FROM book_reports WHERE obra_id = ?', obraId),
    st('DELETE FROM book_posts WHERE obra_id = ?', obraId), // curtidas saem em cascata
    st('DELETE FROM book_pages WHERE obra_id = ?', obraId),
    st('DELETE FROM reader_list_items WHERE obra_id = ?', obraId),
  ];
}

const capaUrl = (id) => (!id ? '' : id.charAt(0) === '/' ? id : `/img/${id}?v=2`);

// exclusao automatica do que passou do prazo (todos os autores). Devolve os usuarios afetados,
// para a limpeza de imagens rodar depois.
export async function limparLixeiraVencida(env, agora) {
  const limite = agora - PRAZO_DIAS * 86400;
  const vencidos = [
    ...(await env.DB.prepare(
      'SELECT t.obra_id AS id, t.user_id, u.slug, 1 AS perfil FROM book_trash t JOIN users u ON u.id = t.user_id WHERE t.removed_at < ?'
    ).bind(limite).all()).results,
    ...(await env.DB.prepare(
      'SELECT w.id, w.user_id, u.slug, 0 AS perfil FROM studio_works w JOIN users u ON u.id = w.user_id WHERE w.deleted_at IS NOT NULL AND w.deleted_at < ?'
    ).bind(limite).all()).results,
  ];
  for (const v of vencidos) {
    await env.DB.batch([
      ...rastros(env, v.slug, v.id),
      v.perfil ? env.DB.prepare('DELETE FROM book_trash WHERE obra_id = ?').bind(v.id) : env.DB.prepare('DELETE FROM studio_works WHERE id = ?').bind(v.id),
    ]);
  }
  return [...new Set(vencidos.map((v) => v.user_id))];
}

// Livros removidos do perfil ANTES da lixeira existir: o cadastro (titulo, sinopse, capa) se perdeu,
// mas avaliacoes, pagina do livro e extras continuam ligados ao id. Aparecem para o autor recuperar
// com o mesmo id (as avaliacoes voltam junto); ele so reescreve o titulo e o resto.
async function orfaos(env, user) {
  const p = await env.DB.prepare('SELECT data FROM profiles WHERE user_id = ?').bind(user.id).first();
  const vivos = new Set((safe(p ? p.data : '{}').obras || []).map((o) => o.id));
  for (const r of (await env.DB.prepare('SELECT id FROM studio_works WHERE user_id = ?').bind(user.id).all()).results) vivos.add(r.id);
  for (const r of (await env.DB.prepare('SELECT obra_id FROM book_trash WHERE user_id = ?').bind(user.id).all()).results) vivos.add(r.obra_id);
  const r = await env.DB.prepare(
    `SELECT obra_id, MIN(t) AS desde FROM (
       SELECT obra_id, created_at AS t FROM reviews WHERE author_slug = ?1
       UNION ALL SELECT obra_id, updated_at FROM book_pages WHERE user_id = ?2
       UNION ALL SELECT obra_id, created_at FROM book_posts WHERE user_id = ?2
     ) GROUP BY obra_id`
  ).bind(user.slug, user.id).all();
  const out = [];
  for (const o of r.results) {
    if (vivos.has(o.obra_id) || !ID_RE.test(o.obra_id)) continue;
    const pg = await env.DB.prepare('SELECT data FROM book_pages WHERE obra_id = ? AND user_id = ?').bind(o.obra_id, user.id).first();
    const n = await env.DB.prepare(
      `SELECT (SELECT COUNT(*) FROM reviews WHERE author_slug = ?1 AND obra_id = ?2) AS avaliacoes,
         (SELECT COUNT(*) FROM book_favorites WHERE obra_id = ?2) AS favoritos`
    ).bind(user.slug, o.obra_id).first();
    out.push({ id: o.obra_id, tipo: 'orfao', titulo: (pg && safe(pg.data).alt_titulos) || '', capa: '', removido_em: 0, ...n });
  }
  return out;
}

// GET /api/lixeira
export async function listarLixeira(env, user, h) {
  const perfil = await env.DB.prepare('SELECT obra_id, data, removed_at FROM book_trash WHERE user_id = ?').bind(user.id).all();
  const estudio = await env.DB.prepare('SELECT id, title, meta, pub_meta, pub_slug, deleted_at FROM studio_works WHERE user_id = ? AND deleted_at IS NOT NULL').bind(user.id).all();
  const itens = [
    ...perfil.results.map((r) => { const o = safe(r.data); return { id: r.obra_id, tipo: 'perfil', titulo: o.titulo || 'Sem título', capa: capaUrl(o.capa), status: o.status || '', removido_em: r.removed_at }; }),
    ...estudio.results.map((w) => {
      const m = { ...safe(w.meta), ...safe(w.pub_meta) };
      return { id: w.id, tipo: 'estudio', titulo: m.titulo || w.title, capa: capaUrl(m.capa), publicada: !!w.pub_slug, removido_em: w.deleted_at };
    }),
  ].sort((a, b) => b.removido_em - a.removido_em);
  itens.push(...(await orfaos(env, user)));
  // o que se perde na exclusao definitiva: mostrado antes de confirmar
  for (const i of itens) {
    if (i.tipo === 'orfao') continue; // ja vem com as contagens
    const n = await env.DB.prepare(
      `SELECT (SELECT COUNT(*) FROM reviews WHERE author_slug = ?1 AND obra_id = ?2) AS avaliacoes,
         (SELECT COUNT(*) FROM book_favorites WHERE obra_id = ?2) AS favoritos`
    ).bind(user.slug, i.id).first();
    Object.assign(i, n);
  }
  for (const i of itens) i.exclui_em = i.tipo === 'orfao' ? 0 : i.removido_em + PRAZO_DIAS * 86400;
  return h.json({ itens, prazo_dias: PRAZO_DIAS });
}

// POST /api/lixeira/:id/restaurar  (livro orfao: { titulo } obrigatorio, o cadastro antigo se perdeu)
export async function restaurar(env, req, user, id, h) {
  if (!ID_RE.test(id)) return h.fail('Livro não encontrado.', 404);
  const t = await env.DB.prepare('SELECT data FROM book_trash WHERE obra_id = ? AND user_id = ?').bind(id, user.id).first();
  let obra = t ? safe(t.data) : null;
  if (!t && (await orfaos(env, user)).some((o) => o.id === id)) {
    const b = (await h.body(req)) || {};
    const titulo = h.str(b.titulo, 120);
    if (!titulo) return h.fail('Escreva o título do livro para recuperá-lo.');
    obra = { id, titulo, genero: '', status: 'Publicado', sinopse: '', faixa: '', publicado_em: '', capa: '', link: '', lojas: [] };
  }
  if (obra) {
    const p = await env.DB.prepare('SELECT data FROM profiles WHERE user_id = ?').bind(user.id).first();
    if (!p) return h.fail('Perfil não encontrado.', 404);
    const d = safe(p.data);
    d.obras = Array.isArray(d.obras) ? d.obras : [];
    if (!d.obras.some((o) => o.id === id)) {
      if (d.obras.length >= MAX_OBRAS_PERFIL) return h.fail(`Seu perfil já tem ${MAX_OBRAS_PERFIL} livros. Remova um para restaurar este.`, 409);
      d.obras.push(obra);
    }
    await env.DB.batch([
      env.DB.prepare('UPDATE profiles SET data = ?, updated_at = ? WHERE user_id = ?').bind(JSON.stringify(d), h.now(), user.id),
      env.DB.prepare('DELETE FROM book_trash WHERE obra_id = ? AND user_id = ?').bind(id, user.id),
    ]);
    return h.json({ ok: true, tipo: 'perfil' });
  }
  const r = await env.DB.prepare('UPDATE studio_works SET deleted_at = NULL, updated_at = ? WHERE id = ? AND user_id = ? AND deleted_at IS NOT NULL').bind(h.now(), id, user.id).run();
  if (!r.meta || r.meta.changes !== 1) return h.fail('Livro não encontrado na lixeira.', 404);
  return h.json({ ok: true, tipo: 'estudio' });
}

// DELETE /api/lixeira/:id (exclusao definitiva: so o que esta na lixeira)
export async function excluirDefinitivo(env, user, id, h) {
  if (!ID_RE.test(id)) return h.fail('Livro não encontrado.', 404);
  const t = await env.DB.prepare('SELECT 1 FROM book_trash WHERE obra_id = ? AND user_id = ?').bind(id, user.id).first();
  const w = t ? null : await env.DB.prepare('SELECT 1 FROM studio_works WHERE id = ? AND user_id = ? AND deleted_at IS NOT NULL').bind(id, user.id).first();
  const orfao = !t && !w && (await orfaos(env, user)).some((o) => o.id === id);
  if (!t && !w && !orfao) return h.fail('Só livros que estão na lixeira podem ser excluídos definitivamente.', 404);
  await env.DB.batch([
    ...rastros(env, user.slug, id),
    ...(t ? [env.DB.prepare('DELETE FROM book_trash WHERE obra_id = ? AND user_id = ?').bind(id, user.id)] : []),
    ...(w ? [env.DB.prepare('DELETE FROM studio_works WHERE id = ? AND user_id = ?').bind(id, user.id)] : []), // documentos, versoes e arquivos em cascata
  ]);
  return h.json({ ok: true });
}
