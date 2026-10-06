// Feedback do beta (feedback.html): qualquer pessoa manda (com ou sem conta); moderadores leem no painel.
// Limite por IP (login_fails, chave fb|ip) contra spam. A pagina de origem vai sem parametros: nunca guarda token.
export const AREAS = {
  inicio: 'Página inicial e Biblioteca', livro: 'Página do livro e leitura', autores: 'Autores e perfis', leitores: 'Leitores e estantes',
  conta: 'Conta, cadastro e senha', estudio: 'Estúdio (escrever)', publicacao: 'Publicação', capa: 'Editor de capa e 3D',
  beta: 'Leitura beta', moderacao: 'Moderação e denúncias', outro: 'Outro',
};
export const CATEGORIAS = { bug: 'Bug (algo quebrou)', confusao: 'Confusão (não entendi)', sugestao: 'Sugestão', visual: 'Visual' };

// POST /api/feedback { area, categoria, descricao, pagina }
export async function enviarFeedback(env, req, h) {
  const b = await h.body(req);
  if (!b) return h.fail('Requisição inválida.');
  const chave = 'fb|' + (req.headers.get('CF-Connecting-IP') || 'x');
  if (await h.tooManyFails(env, chave)) return h.fail('Você mandou vários feedbacks em pouco tempo. Obrigado! Tente de novo daqui a pouco.', 429);
  if (!AREAS[b.area]) return h.fail('Escolha a área do site.');
  if (!CATEGORIAS[b.categoria]) return h.fail('Escolha o tipo: bug, confusão, sugestão ou visual.');
  const descricao = h.str(b.descricao, 3000);
  if (descricao.length < 10) return h.fail('Conte um pouco mais (pelo menos 10 caracteres).');
  const pagina = /^\/[a-z0-9\-/.]{0,80}$/i.test(h.str(b.pagina, 120).split(/[?#]/)[0]) ? h.str(b.pagina, 120).split(/[?#]/)[0] : '';
  const user = await h.currentUser(env, req);
  await h.recordFail(env, chave);
  await env.DB.prepare('INSERT INTO feedback (user_id, area, categoria, descricao, pagina, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(user ? user.id : null, b.area, b.categoria, descricao, pagina, h.now()).run();
  return h.json({ ok: true });
}

// GET /api/admin/feedback[?todos=1] (moderadores)
export async function listarFeedback(env, url, h) {
  const todos = url.searchParams.get('todos') === '1';
  const r = await env.DB.prepare(
    `SELECT f.id, f.area, f.categoria, f.descricao, f.pagina, f.status, f.created_at, u.role,
       COALESCE(NULLIF(json_extract(p.data, '$.nome'), ''), NULLIF(u.nome, ''), u.slug) AS quem
     FROM feedback f LEFT JOIN users u ON u.id = f.user_id LEFT JOIN profiles p ON p.user_id = u.id ${todos ? '' : "WHERE f.status = 'novo'"} ORDER BY f.created_at DESC LIMIT 200`
  ).all();
  return h.json(r.results.map((f) => ({ ...f, area_rotulo: AREAS[f.area] || f.area, categoria_rotulo: CATEGORIAS[f.categoria] || f.categoria })));
}

// POST /api/admin/feedback/:id { status: 'visto' | 'novo' }
export async function marcarFeedback(env, req, id, h) {
  const b = await h.body(req);
  if (!b || !['visto', 'novo'].includes(b.status)) return h.fail('Estado inválido.');
  const r = await env.DB.prepare('UPDATE feedback SET status = ? WHERE id = ?').bind(b.status, id).run();
  if (!r.meta || r.meta.changes !== 1) return h.fail('Feedback não encontrado.', 404);
  return h.json({ ok: true });
}
