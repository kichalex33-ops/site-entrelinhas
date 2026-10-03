// Pagina do livro (obra.html): dados basicos vem do perfil (livro divulgado) ou da copia publicada no Estudio;
// o resto (contexto, estilo, tags, lojas, personagens, galeria, materiais) o autor preenche e fica em book_pages.
// Favoritos, visualizacoes e os posts de "Extras e Notas" ficam em tabelas proprias (migracao 0014).
import { VISIVEL } from './leitura.js';

const OBRA_RE = /^[a-f0-9]{12}$/;
const SLUG_RE = /^[a-z0-9-]{1,40}$/;
export const LIM_PAGINA = { personagens: 16, imagens: 12, materiais: 10, tags: 12, lojas: 6, bytes: 40000 };
const LIM_POSTS = { texto: 3000, porLivro: 100, porDia: 20, lista: 50 };
const vazia = () => ({ alt_titulos: '', aviso: '', contexto: '', estilo: '', tags: [], lojas: [], personagens: [], imagens: [], materiais: [] });
// "#Ficção Científica" -> "ficção-científica"
const tag = (t) => String(t || '').toLowerCase().replace(/^#+/, '').trim().replace(/\s+/g, '-').replace(/[^\p{L}\p{N}-]/gu, '').replace(/-{2,}/g, '-').slice(0, 30);
const safe = (s) => { try { const o = JSON.parse(s); return o && typeof o === 'object' ? o : {}; } catch { return {}; } };

// imagens usadas nas paginas do autor (para a limpeza de imagens sem uso nao apagar)
export async function imagensDasPaginas(env, userId) {
  const r = await env.DB.prepare('SELECT data FROM book_pages WHERE user_id = ?').bind(userId).all();
  const s = new Set();
  for (const row of r.results) {
    const d = safe(row.data);
    for (const p of d.personagens || []) if (p.imagem) s.add(p.imagem);
    for (const i of d.imagens || []) if (i.id) s.add(i.id);
  }
  const posts = await env.DB.prepare("SELECT imagem FROM book_posts WHERE user_id = ? AND imagem != ''").bind(userId).all();
  for (const p of posts.results) s.add(p.imagem);
  return s;
}

async function donoDaObra(env, userId, obraId) {
  const p = await env.DB.prepare('SELECT data FROM profiles WHERE user_id = ?').bind(userId).first();
  if (p && (safe(p.data).obras || []).some((o) => o.id === obraId)) return true;
  return !!(await env.DB.prepare('SELECT 1 FROM studio_works WHERE id = ? AND user_id = ? AND deleted_at IS NULL').bind(obraId, userId).first());
}

// GET /api/livro/:autor/:obra (publico)
export async function getLivro(env, req, autor, obraId, h) {
  if (!SLUG_RE.test(autor) || !OBRA_RE.test(obraId)) return h.fail('Livro não encontrado.', 404);
  const prof = await env.DB.prepare('SELECT data, user_id FROM profiles WHERE slug = ? AND published = 1').bind(autor).first();
  if (!prof || !prof.user_id) return h.fail('Livro não encontrado.', 404);
  const pdata = safe(prof.data);
  const t = h.now();
  let tipo = 'divulgado', obra = (pdata.obras || []).find((o) => o.id === obraId) || null, capitulos = null;

  if (!obra && h.publicacao) {
    const w = await env.DB.prepare(
      `SELECT w.id, w.title, w.pub_slug, w.pub_meta, w.published_at FROM studio_works w
       WHERE w.id = ? AND w.user_id = ? AND w.deleted_at IS NULL AND w.pub_slug IS NOT NULL AND ${VISIVEL}`
    ).bind(obraId, prof.user_id, t).first();
    if (w) {
      const m = safe(w.pub_meta);
      tipo = 'estudio';
      obra = {
        id: w.id, titulo: m.titulo || w.title, genero: m.genero || '', sinopse: m.sinopse || '', capa: m.capa || '', faixa: m.faixa || '',
        creditos: m.creditos || '', status: 'Publicado', no_site_em: w.published_at,
        url: `ler.html?a=${encodeURIComponent(autor)}&o=${encodeURIComponent(w.pub_slug)}`,
      };
      const caps = await env.DB.prepare('SELECT ordem, titulo, palavras FROM studio_pub_docs WHERE work_id = ? ORDER BY ordem').bind(w.id).all();
      capitulos = caps.results.map((c) => ({ n: c.ordem, titulo: c.titulo, palavras: c.palavras }));
    }
  }
  if (!obra) return h.fail('Livro não encontrado.', 404);

  const pg = await env.DB.prepare('SELECT data FROM book_pages WHERE obra_id = ? AND user_id = ?').bind(obraId, prof.user_id).first();
  const av = await env.DB.prepare('SELECT COUNT(*) AS n, AVG(nota) AS media FROM reviews WHERE author_slug = ? AND obra_id = ? AND hidden = 0').bind(autor, obraId).first();
  const viewer = await h.currentUser(env, req);
  const num = await env.DB.prepare(
    `SELECT (SELECT COUNT(*) FROM book_favorites WHERE obra_id = ?1) AS favoritos,
       (SELECT COUNT(*) FROM book_views WHERE obra_id = ?1) AS visualizacoes,
       (SELECT COUNT(*) FROM book_reports WHERE obra_id = ?1 AND status != 'arquivada') AS denuncias,
       (SELECT COUNT(*) FROM book_favorites WHERE obra_id = ?1 AND user_id = ?2) AS meu`
  ).bind(obraId, viewer ? viewer.id : 0).first();
  return h.json({
    tipo, obra, capitulos, pagina: pg ? { ...vazia(), ...safe(pg.data) } : vazia(),
    autor: { slug: autor, nome: pdata.nome || autor, retrato: pdata.retrato || '' },
    avaliacoes: { total: av.n, media: av.n ? Math.round(av.media * 10) / 10 : 0 },
    // denuncias arquivadas (sem fundamento) nao entram no numero publico
    numeros: { favoritos: num.favoritos, visualizacoes: num.visualizacoes, denuncias: num.denuncias },
    favorito: !!num.meu,
    posts: await listarPosts(env, obraId, viewer),
    dono: !!viewer && viewer.id === prof.user_id,
    // so o dono ve que ha denuncias em analise (motivos e quantidade, nunca quem denunciou)
    denuncias: viewer && viewer.id === prof.user_id ? await h.denunciasAbertas(env, obraId) : undefined,
    logado: !!viewer,
  });
}

// PUT /api/livro/:obra (dono)
export async function putLivro(env, req, user, obraId, h) {
  if (user.role !== 'autor') return h.fail('Apenas autores editam páginas de livro.', 403);
  if (!OBRA_RE.test(obraId) || !(await donoDaObra(env, user.id, obraId))) return h.fail('Livro não encontrado.', 404);
  const b = await h.body(req);
  const d = b && b.data && typeof b.data === 'object' ? b.data : null;
  if (!d) return h.fail('Requisição inválida.');
  const out = vazia();
  out.alt_titulos = h.str(d.alt_titulos, 200);
  out.aviso = h.str(d.aviso, 300); // aviso de conteudo (violencia, temas sensiveis...)
  out.contexto = h.str(d.contexto, 4000);
  out.estilo = h.str(d.estilo, 1500);
  for (const t of (Array.isArray(d.tags) ? d.tags : []).map(tag)) if (t && !out.tags.includes(t) && out.tags.length < LIM_PAGINA.tags) out.tags.push(t);
  for (const l of (Array.isArray(d.lojas) ? d.lojas : []).slice(0, LIM_PAGINA.lojas)) {
    const rotulo = h.str(l && l.rotulo, 40), url = h.str(l && l.url, 300);
    if (rotulo && h.isUrl(url)) out.lojas.push({ rotulo, url });
  }
  for (const p of (Array.isArray(d.personagens) ? d.personagens : []).slice(0, LIM_PAGINA.personagens)) {
    const nome = h.str(p && p.nome, 80);
    if (!nome) continue;
    const img = p.imagem && (await h.ownsImage(env, p.imagem, user.id)) ? p.imagem : '';
    out.personagens.push({ nome, papel: h.str(p.papel, 60), descricao: h.str(p.descricao, 800), imagem: img });
  }
  for (const i of (Array.isArray(d.imagens) ? d.imagens : []).slice(0, LIM_PAGINA.imagens)) {
    if (!i || !i.id || !(await h.ownsImage(env, i.id, user.id))) continue;
    out.imagens.push({ id: i.id, legenda: h.str(i.legenda, 120) });
  }
  for (const m of (Array.isArray(d.materiais) ? d.materiais : []).slice(0, LIM_PAGINA.materiais)) {
    const rotulo = h.str(m && m.rotulo, 80), url = h.str(m && m.url, 300);
    if (!rotulo || !h.isUrl(url)) continue;
    out.materiais.push({ rotulo, url, descricao: h.str(m.descricao, 200) });
  }
  const txt = JSON.stringify(out);
  if (txt.length > LIM_PAGINA.bytes) return h.fail('A página ficou grande demais. Encurte as descrições.', 413);
  await env.DB.prepare(
    'INSERT INTO book_pages (obra_id, user_id, data, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(obra_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at WHERE book_pages.user_id = excluded.user_id'
  ).bind(obraId, user.id, txt, h.now()).run();
  return h.json({ ok: true, pagina: out });
}

// ---------- visualizacoes e favoritos ----------
async function hashHex(texto) {
  const b = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto)));
  return [...b.slice(0, 12)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

// POST /api/livro/:autor/:obra/visita (publico): uma visita por visitante por dia; o dono nao conta
export async function visitarLivro(env, req, autor, obraId, h) {
  if (!(await h.obraExists(autor, obraId))) return h.fail('Livro não encontrado.', 404);
  const viewer = await h.currentUser(env, req);
  const dia = Math.floor(h.now() / 86400);
  const quem = viewer ? 'u' + viewer.id : (req.headers.get('CF-Connecting-IP') || '') + '|' + (req.headers.get('User-Agent') || '');
  const visitante = await hashHex(`${quem}|${dia}|${obraId}`);
  if (!viewer || viewer.slug !== autor) await env.DB.prepare('INSERT INTO book_views (obra_id, visitante, dia) VALUES (?, ?, ?) ON CONFLICT DO NOTHING').bind(obraId, visitante, dia).run();
  const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM book_views WHERE obra_id = ?').bind(obraId).first();
  return h.json({ visualizacoes: n.n });
}

// POST /api/livro/:autor/:obra/favorito (logado): liga/desliga
export async function favoritarLivro(env, user, autor, obraId, h) {
  if (!(await h.obraExists(autor, obraId))) return h.fail('Livro não encontrado.', 404);
  const del = await env.DB.prepare('DELETE FROM book_favorites WHERE obra_id = ? AND user_id = ?').bind(obraId, user.id).run();
  const favorito = !(del.meta && del.meta.changes);
  if (favorito) await env.DB.prepare('INSERT INTO book_favorites (obra_id, user_id, created_at) VALUES (?, ?, ?)').bind(obraId, user.id, h.now()).run();
  const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM book_favorites WHERE obra_id = ?').bind(obraId).first();
  return h.json({ favorito, total: n.n });
}

// ---------- Extras e Notas: posts do autor (texto, imagem, spoiler) com curtidas ----------
async function listarPosts(env, obraId, viewer) {
  const r = await env.DB.prepare(
    `SELECT p.id, p.texto, p.imagem, p.spoiler, p.created_at,
       (SELECT COUNT(*) FROM book_post_likes l WHERE l.post_id = p.id) AS curtidas,
       (SELECT COUNT(*) FROM book_post_likes l WHERE l.post_id = p.id AND l.user_id = ?) AS curti
     FROM book_posts p WHERE p.obra_id = ? ORDER BY p.created_at DESC, p.id DESC LIMIT ?`
  ).bind(viewer ? viewer.id : 0, obraId, LIM_POSTS.lista).all();
  return r.results.map((p) => ({ ...p, spoiler: !!p.spoiler, curti: !!p.curti }));
}

// POST /api/livro/:obra/posts (dono)
export async function criarPost(env, req, user, obraId, h) {
  if (user.role !== 'autor') return h.fail('Apenas autores publicam extras.', 403);
  if (!OBRA_RE.test(obraId) || !(await donoDaObra(env, user.id, obraId))) return h.fail('Livro não encontrado.', 404);
  const b = await h.body(req);
  if (!b) return h.fail('Requisição inválida.');
  const texto = h.str(b.texto, LIM_POSTS.texto);
  const imagem = b.imagem && (await h.ownsImage(env, b.imagem, user.id)) ? b.imagem : '';
  if (!texto && !imagem) return h.fail('Escreva um texto ou envie uma imagem.');
  const c = await env.DB.prepare('SELECT COUNT(*) AS total, SUM(created_at > ?) AS hoje FROM book_posts WHERE obra_id = ?').bind(h.now() - 86400, obraId).first();
  if (c.total >= LIM_POSTS.porLivro) return h.fail(`Este livro já tem ${LIM_POSTS.porLivro} extras. Apague os antigos para publicar novos.`, 409);
  if ((c.hoje || 0) >= LIM_POSTS.porDia) return h.fail('Limite de extras por hoje atingido.', 429);
  await env.DB.prepare('INSERT INTO book_posts (obra_id, user_id, texto, imagem, spoiler, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(obraId, user.id, texto, imagem, b.spoiler ? 1 : 0, h.now()).run();
  return h.json({ ok: true, posts: await listarPosts(env, obraId, user) });
}

// DELETE /api/livro/:obra/posts/:id (dono)
export async function apagarPost(env, user, obraId, id, h) {
  const p = await env.DB.prepare('SELECT id FROM book_posts WHERE id = ? AND obra_id = ? AND user_id = ?').bind(id, obraId, user.id).first();
  if (!p) return h.fail('Extra não encontrado.', 404);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM book_post_likes WHERE post_id = ?').bind(id),
    env.DB.prepare('DELETE FROM book_posts WHERE id = ?').bind(id),
  ]);
  return h.json({ ok: true, posts: await listarPosts(env, obraId, user) });
}

// POST /api/livro/posts/:id/curtir (logado): liga/desliga
export async function curtirPost(env, user, id, h) {
  if (!(await env.DB.prepare('SELECT 1 FROM book_posts WHERE id = ?').bind(id).first())) return h.fail('Extra não encontrado.', 404);
  const del = await env.DB.prepare('DELETE FROM book_post_likes WHERE post_id = ? AND user_id = ?').bind(id, user.id).run();
  const curti = !(del.meta && del.meta.changes);
  if (curti) await env.DB.prepare('INSERT INTO book_post_likes (post_id, user_id) VALUES (?, ?)').bind(id, user.id).run();
  const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM book_post_likes WHERE post_id = ?').bind(id).first();
  return h.json({ curti, curtidas: n.n });
}
