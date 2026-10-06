// Perfil de leitor (leitor.html?u=slug): foto, bio, local, contadores, estantes, atividade e autores que segue.
// Seguir e avaliacoes ficam no perfil do autor: leitores nao sao seguidos e as avaliacoes nao aparecem aqui.
// Estantes: cinco fixas (Lendo, Quero ler, Lidos, Pausado, Abandonado; um livro fica em so uma) + listas proprias.
// Perfil privado: visitantes so veem nome, foto e o aviso de privado. Vale para qualquer conta (autor tambem le).
export const FIXAS = [['lendo', 'Lendo'], ['quero', 'Quero ler'], ['lidos', 'Lidos'], ['pausado', 'Pausado'], ['abandonado', 'Abandonado']];
const LIM = { listas: 20, itens: 500, bio: 600 };
const ORDEM = `CASE chave ${FIXAS.map(([c], i) => `WHEN '${c}' THEN ${i}`).join(' ')} ELSE 9 END, created_at`;

async function garantirFixas(env, userId, t) {
  await env.DB.batch(FIXAS.map(([chave, nome]) => env.DB.prepare(
    'INSERT INTO reader_lists (user_id, chave, nome, publica, created_at) VALUES (?, ?, ?, 1, ?) ON CONFLICT DO NOTHING'
  ).bind(userId, chave, nome, t)));
}

// livro visivel no site -> cartao enxuto (livros que sairam do site somem das listas sem quebrar nada)
const cartao = (l) => ({ id: l.id, titulo: l.titulo, capa: l.capa, genero: l.genero, autor: l.autor, href: `obra.html?a=${encodeURIComponent(l.autor.slug)}&o=${encodeURIComponent(l.id)}` });
const cartoes = (mapa, ids) => ids.map((id) => mapa.get(id)).filter(Boolean).map(cartao);

// quem a conta segue (autores e leitores), com nome e foto para mostrar
async function seguidos(env, userId) {
  const r = await env.DB.prepare(
    `SELECT f.seguido_slug AS slug, u.role, u.nome, u.foto, u.privado, json_extract(p.data, '$.nome') AS pnome, json_extract(p.data, '$.retrato') AS retrato
     FROM follows f JOIN users u ON u.slug = f.seguido_slug LEFT JOIN profiles p ON p.slug = u.slug AND p.published = 1
     WHERE f.user_id = ? AND u.role = 'autor' ORDER BY f.created_at DESC`
  ).bind(userId).all();
  return r.results.map((s) => s.role === 'autor'
    ? { slug: s.slug, tipo: 'autor', nome: s.pnome || s.slug, foto: s.retrato || '' }
    : { slug: s.slug, tipo: 'leitor', nome: s.nome || 'Leitor', foto: s.foto || '' });
}

// GET /api/leitores (publico): os leitores cadastrados para a aba Leitores. Perfil privado fica fora
// da lista (quem escolheu privado nao quer ser achado); a bio vai cortada, o perfil completo e no leitor.html.
export async function listarLeitores(env, h) {
  const r = await env.DB.prepare(
    `SELECT u.slug, u.nome, u.foto, u.bio, u.local
     FROM users u WHERE u.role = 'leitor' AND u.privado = 0 LIMIT 1000`
  ).all();
  const lista = r.results.map((u) => ({
    slug: u.slug, nome: u.nome || 'Leitor', foto: u.foto || '', local: u.local || '',
    bio: u.bio.length > 160 ? u.bio.slice(0, 157).trimEnd() + '...' : u.bio,
  }));
  lista.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' }));
  return h.json(lista);
}

// GET /api/leitor/:slug (publico; perfil privado mostra so o basico a visitantes)
export async function verLeitor(env, req, slug, h) {
  const u = await env.DB.prepare('SELECT id, slug, nome, role, bio, foto, local, privado, created_at FROM users WHERE slug = ?').bind(slug).first();
  if (!u) return h.fail('Leitor não encontrado.', 404);
  const viewer = await h.currentUser(env, req);
  const dono = !!viewer && viewer.id === u.id;
  const n = await env.DB.prepare(
    "SELECT COUNT(*) AS seguindo FROM follows f JOIN users s ON s.slug = f.seguido_slug WHERE f.user_id = ? AND s.role = 'autor'"
  ).bind(u.id).first();
  const prof = u.role === 'autor' ? await env.DB.prepare('SELECT data, badges FROM profiles WHERE slug = ?').bind(u.slug).first() : null;
  let nomeAutor = '', selos = [];
  try { nomeAutor = prof ? JSON.parse(prof.data).nome || '' : ''; selos = prof ? JSON.parse(prof.badges) : []; } catch { /* perfil invalido */ }
  const base = {
    slug: u.slug, nome: u.role === 'autor' ? nomeAutor || u.slug : u.nome || 'Leitor', role: u.role, foto: u.foto, desde: u.created_at,
    privado: !!u.privado, dono, logado: !!viewer, seguindo_total: n.seguindo,
  };
  if (u.privado && !dono) return h.json({ ...base, bloqueado: true });

  if (dono) await garantirFixas(env, u.id, h.now());
  const mapa = new Map((await h.livros()).map((l) => [l.id, l]));
  const favRows = (await env.DB.prepare('SELECT obra_id, created_at FROM book_favorites WHERE user_id = ? ORDER BY created_at DESC').bind(u.id).all()).results;
  const listas = (await env.DB.prepare(`SELECT id, chave, nome, publica FROM reader_lists WHERE user_id = ? ${dono ? '' : 'AND publica = 1'} ORDER BY ${ORDEM}`).bind(u.id).all()).results;
  const itens = (await env.DB.prepare('SELECT i.list_id, i.obra_id, i.added_at FROM reader_list_items i JOIN reader_lists l ON l.id = i.list_id WHERE l.user_id = ? ORDER BY i.added_at DESC').bind(u.id).all()).results;
  const seg = await seguidos(env, u.id);

  // atividade recente, montada so com o que ja existe (nada inventado): favoritou e estante.
  // Avaliacoes aparecem so no perfil do autor (em cada livro), nao no perfil de quem avaliou.
  const visiveis = new Map(listas.map((l) => [l.id, l]));
  const atividade = [
    ...favRows.filter((f) => mapa.has(f.obra_id)).map((f) => ({ tipo: 'favoritou', em: f.created_at, livro: cartao(mapa.get(f.obra_id)) })),
    ...itens.filter((i) => visiveis.has(i.list_id) && mapa.has(i.obra_id)).map((i) => ({ tipo: 'estante', em: i.added_at, livro: cartao(mapa.get(i.obra_id)), lista: visiveis.get(i.list_id).nome, chave: visiveis.get(i.list_id).chave })),
  ].sort((a, b) => b.em - a.em).slice(0, 40);

  return h.json({
    ...base, bio: u.bio, local: u.local, selos,
    numeros: { favoritos: favRows.filter((f) => mapa.has(f.obra_id)).length, lidos: itens.filter((i) => (listas.find((l) => l.id === i.list_id) || {}).chave === 'lidos').length },
    favoritos: cartoes(mapa, favRows.map((f) => f.obra_id)), seguindo: seg, atividade,
    listas: listas.map((l) => ({ ...l, publica: !!l.publica, livros: cartoes(mapa, itens.filter((i) => i.list_id === l.id).map((i) => i.obra_id)) })),
  });
}

// PUT /api/leitor (a propria conta): nome (so leitor; autor muda o nome no perfil de autor), bio, local, foto e privacidade
export async function salvarLeitor(env, req, user, h) {
  const b = await h.body(req);
  if (!b) return h.fail('Requisição inválida.');
  const atual = await env.DB.prepare('SELECT nome, bio, foto, local, privado FROM users WHERE id = ?').bind(user.id).first();
  // campos ausentes ficam como estao (a engrenagem do perfil manda so a privacidade)
  const bio = b.bio === undefined ? atual.bio : h.str(b.bio, LIM.bio);
  const local = b.local === undefined ? atual.local : h.str(b.local, 60);
  const privado = typeof b.privado === 'boolean' ? (b.privado ? 1 : 0) : atual.privado;
  const foto = b.foto === undefined ? atual.foto : b.foto && (await h.ownsImage(env, b.foto, user.id)) ? b.foto : '';
  let nome = atual.nome;
  if (user.role === 'leitor' && b.nome !== undefined) {
    nome = h.str(b.nome, 40);
    if (nome.length < 2) return h.fail('Informe seu nome (pelo menos 2 letras).');
  }
  await env.DB.prepare('UPDATE users SET nome = ?, bio = ?, foto = ?, local = ?, privado = ? WHERE id = ?').bind(nome, bio, foto, local, privado, user.id).run();
  // leitor so tem a foto como imagem: as outras (fotos trocadas) saem
  if (user.role === 'leitor') await env.DB.prepare('DELETE FROM images WHERE user_id = ? AND id != ?').bind(user.id, foto).run();
  return h.json({ ok: true, nome, bio, foto, local, privado: !!privado });
}

// GET/POST /api/seguir/:slug (autores e leitores)
export async function seguir(env, user, slug, alternar, h) {
  // so autores sao seguidos (perfil de leitor nao tem "Seguir"); seguir, seguidores e avaliacoes ficam no perfil do autor
  const alvo = await env.DB.prepare('SELECT id, role FROM users WHERE slug = ?').bind(slug).first();
  if (alvo && alvo.role !== 'autor') return h.fail('Só é possível seguir autores.', 400);
  const visivel = alvo && (await env.DB.prepare('SELECT 1 FROM profiles WHERE slug = ? AND published = 1').bind(slug).first());
  if (!visivel) return h.fail('Perfil não encontrado.', 404);
  if (alternar) {
    if (!user) return h.fail('Faça login para seguir.', 401);
    if (alvo.id === user.id) return h.fail('Você não pode seguir a si mesmo.', 403);
    const del = await env.DB.prepare('DELETE FROM follows WHERE user_id = ? AND seguido_slug = ?').bind(user.id, slug).run();
    if (!(del.meta && del.meta.changes)) await env.DB.prepare('INSERT INTO follows (user_id, seguido_slug, created_at) VALUES (?, ?, ?)').bind(user.id, slug, h.now()).run();
  }
  const n = await env.DB.prepare('SELECT COUNT(*) AS n, SUM(user_id = ?) AS eu FROM follows WHERE seguido_slug = ?').bind(user ? user.id : 0, slug).first();
  return h.json({ seguidores: n.n, seguindo: !!n.eu, proprio: !!user && alvo.id === user.id });
}

// GET /api/estantes (a propria conta): listas com os ids dos livros
async function minhasListas(env, user, h) {
  await garantirFixas(env, user.id, h.now());
  const listas = (await env.DB.prepare(`SELECT id, chave, nome, publica FROM reader_lists WHERE user_id = ? ORDER BY ${ORDEM}`).bind(user.id).all()).results;
  const itens = (await env.DB.prepare('SELECT i.list_id, i.obra_id FROM reader_list_items i JOIN reader_lists l ON l.id = i.list_id WHERE l.user_id = ?').bind(user.id).all()).results;
  return listas.map((l) => ({ ...l, publica: !!l.publica, obras: itens.filter((i) => i.list_id === l.id).map((i) => i.obra_id) }));
}
export async function estantes(env, user, h) { return h.json({ listas: await minhasListas(env, user, h) }); }

// POST /api/estantes { nome }: nova lista propria
export async function criarLista(env, req, user, h) {
  const b = (await h.body(req)) || {};
  const nome = h.str(b.nome, 60);
  if (!nome) return h.fail('Dê um nome à lista.');
  const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM reader_lists WHERE user_id = ? AND chave = ''").bind(user.id).first();
  if (n.n >= LIM.listas) return h.fail(`Você já tem ${LIM.listas} listas.`, 409);
  await env.DB.prepare("INSERT INTO reader_lists (user_id, chave, nome, publica, created_at) VALUES (?, '', ?, ?, ?)").bind(user.id, nome, b.publica === false ? 0 : 1, h.now()).run();
  return estantes(env, user, h);
}

// PATCH /api/estantes/:id { nome?, publica? } e DELETE (so listas proprias)
export async function mudarLista(env, req, user, id, h) {
  const l = await env.DB.prepare('SELECT chave FROM reader_lists WHERE id = ? AND user_id = ?').bind(id, user.id).first();
  if (!l) return h.fail('Lista não encontrada.', 404);
  const b = (await h.body(req)) || {};
  if (typeof b.publica === 'boolean') await env.DB.prepare('UPDATE reader_lists SET publica = ? WHERE id = ?').bind(b.publica ? 1 : 0, id).run();
  if (b.nome !== undefined) {
    if (l.chave) return h.fail('As estantes fixas (Lendo, Quero ler, Lidos, Pausado, Abandonado) não mudam de nome.', 403);
    const nome = h.str(b.nome, 60);
    if (!nome) return h.fail('Dê um nome à lista.');
    await env.DB.prepare('UPDATE reader_lists SET nome = ? WHERE id = ?').bind(nome, id).run();
  }
  return estantes(env, user, h);
}
export async function apagarLista(env, user, id, h) {
  const r = await env.DB.prepare("DELETE FROM reader_lists WHERE id = ? AND user_id = ? AND chave = ''").bind(id, user.id).run();
  if (!r.meta || r.meta.changes !== 1) return h.fail('Só listas criadas por você podem ser apagadas.', 404);
  return estantes(env, user, h);
}

// POST /api/estantes/:id/livro { autor, obra }: poe ou tira o livro da lista
export async function alternarLivro(env, req, user, id, h) {
  const l = await env.DB.prepare('SELECT chave FROM reader_lists WHERE id = ? AND user_id = ?').bind(id, user.id).first();
  if (!l) return h.fail('Lista não encontrada.', 404);
  const b = (await h.body(req)) || {};
  if (!/^[a-z0-9-]{1,40}$/.test(b.autor || '') || !/^[a-f0-9]{12}$/.test(b.obra || '') || !(await h.obraExists(b.autor, b.obra))) return h.fail('Livro não encontrado.', 404);
  const del = await env.DB.prepare('DELETE FROM reader_list_items WHERE list_id = ? AND obra_id = ?').bind(id, b.obra).run();
  if (!(del.meta && del.meta.changes)) {
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM reader_list_items WHERE list_id = ?').bind(id).first();
    if (n.n >= LIM.itens) return h.fail('Esta lista está cheia.', 409);
    const st = [env.DB.prepare('INSERT INTO reader_list_items (list_id, obra_id, added_at) VALUES (?, ?, ?)').bind(id, b.obra, h.now())];
    // estantes fixas: o livro sai das outras quatro
    if (l.chave) st.unshift(env.DB.prepare("DELETE FROM reader_list_items WHERE obra_id = ? AND list_id IN (SELECT id FROM reader_lists WHERE user_id = ? AND chave != '' AND id != ?)").bind(b.obra, user.id, id));
    await env.DB.batch(st);
  }
  return estantes(env, user, h);
}
