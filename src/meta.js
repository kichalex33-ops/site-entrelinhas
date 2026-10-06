// SEO e metadados das paginas, num lugar so:
//   - indexar ou nao (robots), por pagina, ligado a chave de lancamento PUBLIC_LAUNCH (wrangler.jsonc)
//   - titulo, descricao e previa de link (Open Graph) de cada livro e autor, escritos no HTML pelo servidor
//   - endereco canonico e dados estruturados (JSON-LD) das paginas publicas
//   - /robots.txt e /sitemap.xml
// As paginas montam o conteudo no navegador, mas quem gera a previa do link e quem indexa nao rodam JavaScript.
// Os arquivos em public/ trazem "noindex" fixo: se algo aqui falhar, a pagina sai sem indexar (falha fechada).
import { VISIVEL } from './leitura.js';
import { livrosPublicos } from './vitrine.js';

const ENT = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ENT[c]);
const resumo = (t, max = 200) => { const s = String(t || '').replace(/\s+/g, ' ').trim(); return s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s; };
const ler = (s) => { try { return JSON.parse(s) || {}; } catch { return {}; } };
const imagem = (id) => (!id ? '' : id.charAt(0) === '/' ? id : `/img/${id}?v=2`);
const SLUG = /^[a-z0-9-]{1,40}$/;
const OBRA = /^[a-z0-9-]{1,80}$/;
const DATA = /^(19|20)\d{2}(-(0[1-9]|1[0-2]))?$/;

// Paginas que podem ser indexadas quando PUBLIC_LAUNCH = "on". Todo o resto (conta, Estudio, lixeira, chat,
// recuperar/redefinir senha, confirmar e-mail, leitura beta, leitores, editor de capa...) fica sempre noindex.
export const INDEXAVEIS = ['', 'autores', 'autor', 'obra', 'ler', 'sobre', 'termos', 'privacidade', 'diretrizes'];
// paginas institucionais fixas que entram no sitemap (alem dos autores e livros)
const FIXAS = ['', 'autores', 'sobre', 'termos', 'privacidade', 'diretrizes'];
export const lancado = (env) => env.PUBLIC_LAUNCH === 'on';
// nome da pagina pelo caminho: "/" e "/index.html" -> "", "/autor.html" e "/autor" -> "autor"
const paginaDe = (pathname) => pathname.replace(/^\/+/, '').replace(/\.html$/, '').replace(/^index$/, '');

async function perfil(env, slug) {
  const p = await env.DB.prepare('SELECT data FROM profiles WHERE slug = ? AND published = 1 AND user_id IS NOT NULL').bind(slug).first();
  return p ? ler(p.data) : null;
}

// livro pelo id (obra.html) ou pelo endereco publico do Estudio (ler.html)
async function livro(env, autor, chave, { porSlug = false, publicacao, agora }) {
  const d = await perfil(env, autor);
  if (!d) return null;
  const autorNome = d.nome || autor;
  if (!porSlug) {
    const o = (d.obras || []).find((x) => x.id === chave && x.status === 'Publicado');
    if (o) return { titulo: o.titulo, sinopse: o.sinopse, capa: o.capa, genero: o.genero, autorNome, data: DATA.test(o.publicado_em || '') ? o.publicado_em : '' };
  }
  if (!publicacao) return null;
  const w = await env.DB.prepare(
    `SELECT w.title, w.pub_meta, w.published_at FROM studio_works w JOIN users u ON u.id = w.user_id
     WHERE u.slug = ? AND ${porSlug ? 'w.pub_slug' : 'w.id'} = ? AND w.deleted_at IS NULL AND w.pub_slug IS NOT NULL AND ${VISIVEL}`
  ).bind(autor, chave, agora).first();
  if (!w) return null;
  const m = ler(w.pub_meta);
  const data = w.published_at ? new Date(w.published_at * 1000).toISOString().slice(0, 10) : '';
  return { titulo: m.titulo || w.title, sinopse: m.sinopse, capa: m.capa, genero: m.genero, autorNome, data };
}

// endereco canonico: sem ".html" e so com os parametros que identificam a pagina
function canonico(url, pagina) {
  const u = new URL(url.origin + '/' + pagina);
  if (pagina === 'autor') u.searchParams.set('a', url.searchParams.get('a') || '');
  if (pagina === 'obra' || pagina === 'ler') { u.searchParams.set('a', url.searchParams.get('a') || ''); u.searchParams.set('o', url.searchParams.get('o') || ''); }
  return u.href;
}

// dados de cada pagina: titulo/descricao/imagem (Open Graph) e o JSON-LD. null = pagina de entidade que nao existe.
async function dadosDaPagina(env, url, pagina, h) {
  const origem = url.origin;
  if (pagina === '') {
    return { jsonld: {
      '@context': 'https://schema.org', '@type': 'Organization', name: 'Entrelinhas', alternateName: 'Coletivo Entrelinhas',
      url: origem + '/', logo: origem + '/marca/raposa-512.png', email: 'contato@entrelinhasbr.com.br',
      description: 'Coletivo de escritores independentes: livros para ler, perfis de autores e ferramentas para escrever e publicar.',
    } };
  }
  if (!['autor', 'obra', 'ler'].includes(pagina)) return {};
  const a = url.searchParams.get('a') || '', o = url.searchParams.get('o') || '';
  if (!SLUG.test(a)) return null;
  if (pagina === 'autor') {
    const d = await perfil(env, a);
    if (!d) return null;
    const img = imagem(d.retrato);
    const pessoa = { '@context': 'https://schema.org', '@type': 'Person', name: d.nome || a, url: canonico(url, 'autor') };
    const desc = resumo(d.frase || d.bio, 300);
    if (desc) pessoa.description = desc;
    if (img) pessoa.image = new URL(img, origem).href;
    const links = (d.links || []).map((l) => l && l.url).filter((u) => /^https?:\/\//.test(u || ''));
    if (links.length) pessoa.sameAs = links;
    return {
      titulo: `${d.nome || a} | Entrelinhas`, descricao: resumo(d.frase || d.bio || `Perfil de ${d.nome || a} no Entrelinhas, coletivo de escritores independentes.`),
      imagem: img, tipo: 'profile', jsonld: pessoa,
    };
  }
  if (!OBRA.test(o)) return null;
  const l = await livro(env, a, o, { porSlug: pagina === 'ler', publicacao: h.publicacao, agora: h.now() });
  if (!l) return null;
  const desc = l.sinopse ? resumo(l.sinopse) : `${l.genero ? l.genero + ', de ' : 'De '}${l.autorNome}. No Entrelinhas, coletivo de escritores independentes.`;
  const img = imagem(l.capa);
  const book = {
    '@context': 'https://schema.org', '@type': 'Book', name: l.titulo, url: canonico(url, pagina), inLanguage: 'pt-BR',
    author: { '@type': 'Person', name: l.autorNome, url: `${origem}/autor?a=${encodeURIComponent(a)}` },
  };
  if (l.sinopse) book.description = resumo(l.sinopse, 500);
  if (img) book.image = new URL(img, origem).href;
  if (l.genero) book.genre = l.genero;
  if (l.data) book.datePublished = l.data;
  return { titulo: `${l.titulo} · ${l.autorNome} | Entrelinhas`, descricao: desc, imagem: img, tipo: 'book', jsonld: book };
}

// recebe a resposta do arquivo estatico; devolve uma copia com robots, canonico, previa de link e JSON-LD
export async function comMetadados(req, env, resp, h) {
  if (req.method !== 'GET' || !resp.ok || !/text\/html/.test(resp.headers.get('Content-Type') || '')) return resp;
  const url = new URL(req.url);
  const pagina = paginaDe(url.pathname);
  const indexavel = INDEXAVEIS.includes(pagina);
  let m = {};
  if (indexavel) {
    try { m = await dadosDaPagina(env, url, pagina, h); } catch { return resp; } // sem banco: a pagina sai como esta (noindex)
  }
  const robots = lancado(env) && indexavel && m ? 'index,follow' : 'noindex,nofollow';

  const tags = [`<meta name="robots" content="${robots}">`];
  if (indexavel && m) tags.push(`<link rel="canonical" href="${esc(canonico(url, pagina))}">`);
  if (m && m.titulo) {
    const img = m.imagem ? new URL(m.imagem, url.origin).href : `${url.origin}/marca/simbolo.jpg`;
    tags.push(
      `<meta name="description" content="${esc(m.descricao)}">`,
      `<meta property="og:site_name" content="Entrelinhas">`,
      `<meta property="og:type" content="${m.tipo}">`,
      `<meta property="og:title" content="${esc(m.titulo.replace(/ \| Entrelinhas$/, ''))}">`,
      `<meta property="og:description" content="${esc(m.descricao)}">`,
      `<meta property="og:url" content="${esc(canonico(url, pagina))}">`,
      `<meta property="og:image" content="${esc(img)}">`,
      `<meta property="og:locale" content="pt_BR">`,
      `<meta name="twitter:card" content="${m.imagem ? 'summary_large_image' : 'summary'}">`,
    );
  }
  // JSON-LD: "<" escapado para o texto do autor nunca fechar o <script>
  if (m && m.jsonld) tags.push(`<script type="application/ld+json">${JSON.stringify(m.jsonld).replace(/</g, '\\u003c')}</script>`);

  let html = await resp.text();
  html = html.replace(/<meta name="robots"[^>]*>\s*/g, '').replace(/<link rel="canonical"[^>]*>\s*/g, '');
  if (m && m.titulo) {
    html = html
      .replace(/<meta (name="description"|property="og:[a-z_:]+"|name="twitter:[a-z]+")[^>]*>\s*/g, '')
      .replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(m.titulo)}</title>`);
  }
  html = html.replace('</head>', `${tags.join('\n')}\n</head>`);
  const headers = new Headers(resp.headers);
  headers.delete('Content-Length'); headers.delete('ETag');
  headers.set('X-Robots-Tag', robots);
  return new Response(html, { status: resp.status, headers });
}

// GET /robots.txt: antes do lancamento nao anuncia o sitemap (as paginas ja saem com noindex).
// A API fica de fora sempre; as paginas privadas se protegem com noindex (bloquear aqui esconderia o noindex).
export function robotsTxt(env, url) {
  const linhas = ['User-agent: *', 'Disallow: /api/'];
  if (lancado(env)) linhas.push('', `Sitemap: ${url.origin}/sitemap.xml`);
  return new Response(linhas.join('\n') + '\n', { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
}

// GET /sitemap.xml: so o que e publico agora (autores publicados, livros visiveis, paginas institucionais).
// Rascunhos, obras despublicadas e agendamentos futuros nao entram (livrosPublicos ja filtra).
export async function sitemapXml(env, url, h) {
  const o = url.origin;
  const itens = FIXAS.map((p) => ({ loc: `${o}/${p}` }));
  const perfis = (await env.DB.prepare('SELECT slug, updated_at FROM profiles WHERE published = 1 AND user_id IS NOT NULL ORDER BY slug').all()).results;
  for (const p of perfis) itens.push({ loc: `${o}/autor?a=${encodeURIComponent(p.slug)}`, lastmod: p.updated_at });
  for (const l of await livrosPublicos(env, h)) {
    const a = encodeURIComponent(l.autor.slug);
    itens.push({ loc: `${o}/obra?a=${a}&o=${encodeURIComponent(l.id)}`, lastmod: l.no_site_em || 0 });
    const lr = l.ler && /[?&]o=([^&]+)/.exec(l.ler);
    if (lr) itens.push({ loc: `${o}/ler?a=${a}&o=${lr[1]}`, lastmod: l.no_site_em || 0 });
  }
  const data = (t) => (t ? `<lastmod>${new Date(t * 1000).toISOString().slice(0, 10)}</lastmod>` : '');
  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    + itens.map((i) => `  <url><loc>${esc(i.loc)}</loc>${data(i.lastmod)}</url>`).join('\n') + '\n</urlset>\n';
  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=900' } });
}
