// Titulo, descricao e previa de link (Open Graph) de cada livro e autor, escritos no HTML pelo servidor.
// As paginas montam o conteudo no navegador, mas quem gera a previa do link (WhatsApp, redes sociais, buscadores)
// nao roda JavaScript: sem isto, todo link compartilhado mostraria so o titulo generico do site.
// Nao mexe no "noindex": indexar ou nao continua decidido em cada pagina.
import { VISIVEL } from './leitura.js';

const ENT = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ENT[c]);
const resumo = (t, max = 200) => { const s = String(t || '').replace(/\s+/g, ' ').trim(); return s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s; };
const ler = (s) => { try { return JSON.parse(s) || {}; } catch { return {}; } };
const imagem = (id) => (!id ? '' : id.charAt(0) === '/' ? id : `/img/${id}?v=2`);
const SLUG = /^[a-z0-9-]{1,40}$/;
const OBRA = /^[a-z0-9-]{1,80}$/;

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
    if (o) return { titulo: o.titulo, sinopse: o.sinopse, capa: o.capa, genero: o.genero, autorNome };
  }
  if (!publicacao) return null;
  const w = await env.DB.prepare(
    `SELECT w.title, w.pub_meta FROM studio_works w JOIN users u ON u.id = w.user_id
     WHERE u.slug = ? AND ${porSlug ? 'w.pub_slug' : 'w.id'} = ? AND w.deleted_at IS NULL AND w.pub_slug IS NOT NULL AND ${VISIVEL}`
  ).bind(autor, chave, agora).first();
  if (!w) return null;
  const m = ler(w.pub_meta);
  return { titulo: m.titulo || w.title, sinopse: m.sinopse, capa: m.capa, genero: m.genero, autorNome };
}

async function dadosDaPagina(env, url, h) {
  const pagina = url.pathname.replace(/\.html$/, '');
  const a = url.searchParams.get('a') || '', o = url.searchParams.get('o') || '';
  if (!SLUG.test(a)) return null;
  if (pagina === '/autor') {
    const d = await perfil(env, a);
    if (!d) return null;
    return { titulo: `${d.nome || a} | Entrelinhas`, descricao: resumo(d.frase || d.bio || `Perfil de ${d.nome || a} no Entrelinhas, coletivo de escritores independentes.`), imagem: imagem(d.retrato), tipo: 'profile' };
  }
  if ((pagina === '/obra' || pagina === '/ler') && OBRA.test(o)) {
    const l = await livro(env, a, o, { porSlug: pagina === '/ler', publicacao: h.publicacao, agora: h.now() });
    if (!l) return null;
    const desc = l.sinopse ? resumo(l.sinopse) : `${l.genero ? l.genero + ', de ' : 'De '}${l.autorNome}. No Entrelinhas, coletivo de escritores independentes.`;
    return { titulo: `${l.titulo} · ${l.autorNome} | Entrelinhas`, descricao: desc, imagem: imagem(l.capa), tipo: 'book' };
  }
  return null;
}

// recebe a resposta do arquivo estatico; devolve a mesma, ou uma copia com os metadados da pagina
export async function comMetadados(req, env, resp, h) {
  if (req.method !== 'GET' || !resp.ok || !/text\/html/.test(resp.headers.get('Content-Type') || '')) return resp;
  const url = new URL(req.url);
  if (!/^\/(obra|autor|ler)(\.html)?$/.test(url.pathname)) return resp;
  let m = null;
  try { m = await dadosDaPagina(env, url, h); } catch { return resp; } // sem banco: a pagina sai como sempre
  if (!m) return resp;

  const img = m.imagem ? new URL(m.imagem, url.origin).href : `${url.origin}/marca/simbolo.jpg`;
  const tags = [
    `<meta name="description" content="${esc(m.descricao)}">`,
    `<meta property="og:site_name" content="Entrelinhas">`,
    `<meta property="og:type" content="${m.tipo}">`,
    `<meta property="og:title" content="${esc(m.titulo.replace(/ \| Entrelinhas$/, ''))}">`,
    `<meta property="og:description" content="${esc(m.descricao)}">`,
    `<meta property="og:url" content="${esc(url.origin + url.pathname + url.search)}">`,
    `<meta property="og:image" content="${esc(img)}">`,
    `<meta property="og:locale" content="pt_BR">`,
    `<meta name="twitter:card" content="${m.imagem ? 'summary_large_image' : 'summary'}">`,
  ].join('\n');
  let html = await resp.text();
  html = html
    .replace(/<meta (name="description"|property="og:[a-z_:]+"|name="twitter:[a-z]+")[^>]*>\s*/g, '')
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(m.titulo)}</title>`)
    .replace('</head>', `${tags}\n</head>`);
  const headers = new Headers(resp.headers);
  headers.delete('Content-Length'); headers.delete('ETag');
  return new Response(html, { status: resp.status, headers });
}
