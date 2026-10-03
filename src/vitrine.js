// Vitrine publica (pagina inicial e Biblioteca): todos os livros reais do site, vindos do banco.
//   - livros divulgados nos perfis publicados (situacao "Publicado")
//   - obras publicadas pelo Estudio (copia publica visivel)
import { VISIVEL } from './leitura.js';

const safe = (s) => { try { const o = JSON.parse(s); return o && typeof o === 'object' ? o : {}; } catch { return {}; } };
const capaUrl = (id) => (!id ? '' : id.charAt(0) === '/' ? id : `/img/${id}?v=2`);

export async function vitrine(env, h) {
  const t = h.now();
  const livros = [];
  const perfis = await env.DB.prepare('SELECT slug, data FROM profiles WHERE published = 1 AND user_id IS NOT NULL').all();
  const nomes = new Map();
  for (const p of perfis.results) {
    const d = safe(p.data);
    nomes.set(p.slug, d.nome || p.slug);
    for (const o of d.obras || []) {
      if (o.status !== 'Publicado' || !o.id) continue;
      livros.push({
        id: o.id, tipo: 'divulgado', titulo: o.titulo, autor: { slug: p.slug, nome: d.nome || p.slug },
        genero: o.genero || '', faixa: o.faixa || '', capa: capaUrl(o.capa), sinopse: o.sinopse || '',
        lancamento: o.publicado_em || '', no_site_em: o.no_site_em || 0,
      });
    }
  }
  if (h.publicacao) {
    const r = await env.DB.prepare(
      `SELECT w.id, w.title, w.pub_slug, w.pub_meta, w.published_at, u.slug AS autor
       FROM studio_works w JOIN users u ON u.id = w.user_id
       WHERE w.deleted_at IS NULL AND w.pub_slug IS NOT NULL AND ${VISIVEL} ORDER BY w.published_at DESC LIMIT 200`
    ).bind(t).all();
    for (const w of r.results) {
      if (!nomes.has(w.autor)) continue; // so autores com perfil publicado
      const m = safe(w.pub_meta);
      livros.push({
        id: w.id, tipo: 'estudio', titulo: m.titulo || w.title, autor: { slug: w.autor, nome: nomes.get(w.autor) },
        genero: m.genero || '', faixa: m.faixa || '', capa: capaUrl(m.capa), sinopse: m.sinopse || '',
        lancamento: '', no_site_em: w.published_at || 0,
        ler: `ler.html?a=${encodeURIComponent(w.autor)}&o=${encodeURIComponent(w.pub_slug)}`,
      });
    }
  }
  // nota media das avaliacoes de cada livro
  const av = await env.DB.prepare('SELECT author_slug, obra_id, COUNT(*) AS n, AVG(nota) AS media FROM reviews WHERE hidden = 0 GROUP BY author_slug, obra_id').all();
  const notas = new Map(av.results.map((x) => [`${x.author_slug}/${x.obra_id}`, x]));
  for (const l of livros) {
    const x = notas.get(`${l.autor.slug}/${l.id}`);
    l.avaliacoes = { total: x ? x.n : 0, media: x ? Math.round(x.media * 10) / 10 : 0 };
  }
  return h.json({ livros });
}
