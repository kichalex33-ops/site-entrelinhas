// Pagina do livro (obra.html): dados basicos vem do perfil (livro divulgado) ou da copia publicada no Estudio;
// o resto (contexto, estilo, personagens, galeria, materiais) o autor preenche e fica em book_pages.
import { VISIVEL } from './leitura.js';

const OBRA_RE = /^[a-f0-9]{12}$/;
const SLUG_RE = /^[a-z0-9-]{1,40}$/;
export const LIM_PAGINA = { personagens: 16, imagens: 12, materiais: 10, bytes: 40000 };
const vazia = () => ({ alt_titulos: '', contexto: '', estilo: '', personagens: [], imagens: [], materiais: [] });
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
  const viewer = await h.currentUser(env, req);
  return h.json({
    tipo, obra, capitulos, pagina: pg ? { ...vazia(), ...safe(pg.data) } : vazia(),
    autor: { slug: autor, nome: pdata.nome || autor },
    dono: !!viewer && viewer.id === prof.user_id,
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
  out.contexto = h.str(d.contexto, 4000);
  out.estilo = h.str(d.estilo, 1500);
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
