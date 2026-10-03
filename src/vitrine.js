// Vitrine publica (pagina inicial e Biblioteca): todos os livros reais do site, vindos do banco.
//   - livros divulgados nos perfis publicados (situacao "Publicado")
//   - obras publicadas pelo Estudio (copia publica visivel)
import { VISIVEL } from './leitura.js';

const safe = (s) => { try { const o = JSON.parse(s); return o && typeof o === 'object' ? o : {}; } catch { return {}; } };
const capaUrl = (id) => (!id ? '' : id.charAt(0) === '/' ? id : `/img/${id}?v=2`);

export async function vitrine(env, h) {
  return h.json({ livros: await livrosPublicos(env, h) });
}

// todos os livros visiveis no site (usado tambem pelas estantes e favoritos do perfil de leitor)
export async function livrosPublicos(env, h) {
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

  // popularidade por periodo: visitas unicas (uma por pessoa por dia) + 3 x favoritos + 2 x avaliacoes recebidas no periodo.
  // Favoritar e avaliar exigem conta; a visita ja vem deduplicada. Nada aqui conta clique repetido.
  const hoje = Math.floor(t / 86400), DIAS = { semana: 7, mes: 30, ano: 365 };
  const pop = new Map();
  const somar = (rows, peso) => {
    for (const r of rows) {
      const p = pop.get(r.obra_id) || { semana: 0, mes: 0, ano: 0 };
      p.semana += peso * r.semana; p.mes += peso * r.mes; p.ano += peso * r.ano;
      pop.set(r.obra_id, p);
    }
  };
  // contagem por periodo numa consulta so: ?1 = inicio da semana, ?2 = do mes, ?3 = do ano
  const contar = (tabela, col, extra = '') => env.DB.prepare(
    `SELECT obra_id, SUM(${col} >= ?1) AS semana, SUM(${col} >= ?2) AS mes, COUNT(*) AS ano FROM ${tabela} WHERE ${col} >= ?3 ${extra} GROUP BY obra_id`
  );
  const emDias = [DIAS.semana, DIAS.mes, DIAS.ano].map((d) => hoje - d + 1);
  const emSegundos = [DIAS.semana, DIAS.mes, DIAS.ano].map((d) => t - d * 86400);
  somar((await contar('book_views', 'dia').bind(...emDias).all()).results, 1);
  somar((await contar('book_favorites', 'created_at').bind(...emSegundos).all()).results, 3);
  somar((await contar('reviews', 'created_at', 'AND hidden = 0').bind(...emSegundos).all()).results, 2);
  for (const l of livros) l.popular = pop.get(l.id) || { semana: 0, mes: 0, ano: 0 };
  return livros;
}
