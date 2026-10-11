// Comunidade (aba nova da pagina inicial): noticias, resenhas, recomendacoes de leitura e dicas de escrita.
// Ler e publico. Postam autores e moderadores (leitor nao posta). O dono edita e apaga; o moderador oculta qualquer post.
// Texto simples (paragrafos), sem HTML: o navegador escapa tudo ao montar a pagina.
export const TIPOS_POST = { noticia: 'Notícia', resenha: 'Resenha', recomendacao: 'Recomendação de leitura', dica: 'Dica de escrita' };
const LIM = { titulo: 120, texto: 6000, livro: 160, link: 300, porDia: 5, pagina: 20 };

const nomeSql = "COALESCE(CASE WHEN u.role = 'autor' THEN json_extract(p.data, '$.nome') END, u.nome, u.slug)";
const SELECT = `SELECT c.id, c.tipo, c.titulo, c.texto, c.livro, c.link, c.created_at, c.updated_at, c.hidden, c.user_id,
    u.slug, u.role, ${nomeSql} AS nome, COALESCE(p.published, 0) AS perfil_publicado
  FROM community_posts c JOIN users u ON u.id = c.user_id LEFT JOIN profiles p ON p.user_id = u.id`;

export const podePostar = (user) => !!user && (user.role === 'autor' || !!user.is_admin);

const saida = (r, user) => ({
  id: r.id, tipo: r.tipo, titulo: r.titulo, texto: r.texto, livro: r.livro, link: r.link,
  criado_em: r.created_at, editado_em: r.updated_at > r.created_at + 60 ? r.updated_at : null,
  autor: { nome: r.nome, slug: r.role === 'autor' && r.perfil_publicado ? r.slug : null },
  ...(r.hidden ? { oculto: true } : {}),
  meu: !!user && user.id === r.user_id,
});

// GET /api/comunidade?tipo=resenha&antes=<id>&n=3 (publico). Moderador ve tambem os ocultos (marcados).
export async function listarPosts(env, url, user, h) {
  const tipo = url.searchParams.get('tipo');
  const antes = Number(url.searchParams.get('antes')) || 0;
  const n = Math.min(LIM.pagina, Math.max(1, Number(url.searchParams.get('n')) || LIM.pagina));
  const mod = !!(user && user.is_admin);
  const cond = [], args = [];
  if (!mod) cond.push('c.hidden = 0');
  if (TIPOS_POST[tipo]) { cond.push('c.tipo = ?'); args.push(tipo); }
  if (antes) { cond.push('c.id < ?'); args.push(antes); }
  const r = await env.DB.prepare(`${SELECT} ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''} ORDER BY c.id DESC LIMIT ?`).bind(...args, n + 1).all();
  const linhas = r.results.slice(0, n);
  return h.json({
    tipos: TIPOS_POST,
    posts: linhas.map((x) => saida(x, user)),
    mais: r.results.length > n ? linhas[linhas.length - 1].id : null,
    eu: user ? { pode_postar: podePostar(user), mod } : null,
  });
}

function validar(b, h) {
  if (!b) return [null, 'Requisição inválida.'];
  if (!TIPOS_POST[b.tipo]) return [null, 'Escolha o tipo do post.'];
  const titulo = h.str(b.titulo, LIM.titulo), texto = h.str(b.texto, LIM.texto), livro = h.str(b.livro, LIM.livro), link = h.str(b.link, LIM.link);
  if (titulo.length < 3) return [null, 'Dê um título ao post.'];
  if (texto.length < 20) return [null, 'Escreva o texto do post (pelo menos 20 caracteres).'];
  if (link && !h.isUrl(link)) return [null, 'O link precisa começar com https://.'];
  if ((b.tipo === 'resenha' || b.tipo === 'recomendacao') && !livro) return [null, 'Diga qual é o livro (título e autor).'];
  return [{ tipo: b.tipo, titulo, texto, livro, link }, null];
}

// POST /api/comunidade (autor ou moderador)
export async function criarPost(env, req, user, h) {
  const [p, erro] = validar(await h.body(req), h);
  if (erro) return h.fail(erro);
  const t = h.now();
  const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM community_posts WHERE user_id = ? AND created_at > ?').bind(user.id, t - 86400).first();
  if (n.n >= LIM.porDia && !user.is_admin) return h.fail(`No máximo ${LIM.porDia} posts por dia.`, 429);
  const r = await env.DB.prepare('INSERT INTO community_posts (user_id, tipo, titulo, texto, livro, link, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(user.id, p.tipo, p.titulo, p.texto, p.livro, p.link, t, t).run();
  return h.json({ ok: true, id: r.meta.last_row_id });
}

// PUT /api/comunidade/:id (so o dono)
export async function editarPost(env, req, user, id, h) {
  const [p, erro] = validar(await h.body(req), h);
  if (erro) return h.fail(erro);
  const r = await env.DB.prepare('UPDATE community_posts SET tipo = ?, titulo = ?, texto = ?, livro = ?, link = ?, updated_at = ? WHERE id = ? AND user_id = ?')
    .bind(p.tipo, p.titulo, p.texto, p.livro, p.link, h.now(), id, user.id).run();
  if (!r.meta || r.meta.changes !== 1) return h.fail('Post não encontrado.', 404);
  return h.json({ ok: true });
}

// DELETE /api/comunidade/:id (dono ou moderador)
export async function apagarPost(env, user, id, h) {
  const r = user.is_admin
    ? await env.DB.prepare('DELETE FROM community_posts WHERE id = ?').bind(id).run()
    : await env.DB.prepare('DELETE FROM community_posts WHERE id = ? AND user_id = ?').bind(id, user.id).run();
  if (!r.meta || r.meta.changes !== 1) return h.fail('Post não encontrado.', 404);
  return h.json({ ok: true });
}

// POST /api/comunidade/:id/ocultar { ocultar: true|false } (moderador)
export async function ocultarPost(env, req, user, id, h) {
  const b = await h.body(req);
  const ocultar = !(b && b.ocultar === false);
  const r = await env.DB.prepare('UPDATE community_posts SET hidden = ?, hidden_by = ?, hidden_at = ? WHERE id = ?')
    .bind(ocultar ? 1 : 0, ocultar ? user.id : null, ocultar ? h.now() : null, id).run();
  if (!r.meta || r.meta.changes !== 1) return h.fail('Post não encontrado.', 404);
  return h.json({ ok: true, oculto: ocultar });
}
