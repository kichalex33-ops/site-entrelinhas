// Leitura PUBLICA das obras publicadas no Estudio. So le a copia (snapshot) feita ao publicar:
// nada de rascunho, nota, ficha, pesquisa ou capitulo nao publicado passa por aqui.

// Condicao de "obra visivel ao publico": publicada/atualizada, ou agendada cuja hora ja chegou.
export const VISIVEL = "(w.status IN ('publicado', 'atualizado') OR (w.status = 'agendado' AND w.scheduled_at <= ?))";

// O que e privado sai na hora de ler: [[Titulo|alias]] vira so o texto e #hashtag some (mesma regra da exportacao).
const LINK_RE = /\\?\[\\?\[([^\[\]\n|\\]{1,120})(?:\|([^\[\]\n]*))?\\?\]\\?\]/g;
const HASHTAG_RE = /(^|[\s(>])\\?#[\p{L}][\p{L}\p{N}_-]{1,29}(?![\p{L}\p{N}_-])/gu;
const HASHTAG_ANTES_DE_PONTO_RE = /[ \t]+\\?#[\p{L}][\p{L}\p{N}_-]{1,29}(?![\p{L}\p{N}_-])(?=[.,;:!?)”"'])/gu;
export function limparPrivado(md) {
  return String(md || '')
    .replace(LINK_RE, (_m, titulo, alias) => (alias || titulo).trim())
    .replace(HASHTAG_ANTES_DE_PONTO_RE, '')
    .replace(HASHTAG_RE, '$1')
    .replace(/[ \t]+$/gm, '').replace(/([^\n\s])[ \t]{2,}(?=\S)/g, '$1 ');
}

const SLUG_RE = /^[a-z0-9-]{1,40}$/;
const OBRA_SLUG_RE = /^[a-z0-9-]{1,60}$/;
const nomeDoAutor = (pdata) => { try { return JSON.parse(pdata).nome || 'Autor'; } catch { return 'Autor'; } };

function resumo(w, extra = {}) {
  const meta = safe(w.pub_meta);
  return {
    id: w.id, slug: w.pub_slug, titulo: meta.titulo || w.title, genero: meta.genero || '', sinopse: meta.sinopse || '', creditos: meta.creditos || '',
    capa: meta.capa || '', publicado_em: w.published_at, versao: w.pub_version, ...extra,
  };
}
function safe(s) { try { const o = JSON.parse(s); return o && typeof o === 'object' ? o : {}; } catch { return {}; } }

// ---- usados pelo index.js
export async function publicadasDoAutor(env, autorSlug, agora) {
  const r = await env.DB.prepare(
    `SELECT w.id, w.title, w.pub_slug, w.pub_meta, w.pub_version, w.published_at,
       (SELECT COUNT(*) FROM studio_pub_docs d WHERE d.work_id = w.id) AS capitulos,
       (SELECT COALESCE(SUM(d.palavras), 0) FROM studio_pub_docs d WHERE d.work_id = w.id) AS palavras
     FROM studio_works w JOIN users u ON u.id = w.user_id
     WHERE u.slug = ? AND w.deleted_at IS NULL AND w.pub_slug IS NOT NULL AND ${VISIVEL} ORDER BY w.published_at DESC LIMIT 50`
  ).bind(autorSlug, agora).all();
  return r.results.map((w) => ({ ...resumo(w, { url: `ler.html?a=${encodeURIComponent(autorSlug)}&o=${encodeURIComponent(w.pub_slug)}` }), capitulos: w.capitulos, palavras: w.palavras }));
}
export async function obraPublicada(env, autorSlug, obraId, agora) {
  const r = await env.DB.prepare(
    `SELECT 1 FROM studio_works w JOIN users u ON u.id = w.user_id WHERE u.slug = ? AND w.id = ? AND w.deleted_at IS NULL AND w.pub_slug IS NOT NULL AND ${VISIVEL}`
  ).bind(autorSlug, obraId, agora).first();
  return !!r;
}

// ---- rotas publicas: /api/leitura/:autor/:obra[/:n] e /api/biblioteca. Retorna Response ou null (nao e comigo).
export async function leituraPublica(req, env, url, h) {
  const path = url.pathname;
  if (req.method !== 'GET') return null;
  const agora = h.now();

  if (path === '/api/biblioteca') {
    const r = await env.DB.prepare(
      `SELECT w.id, w.title, w.pub_slug, w.pub_meta, w.pub_version, w.published_at, u.slug AS autor, p.data AS pdata,
         (SELECT COUNT(*) FROM studio_pub_docs d WHERE d.work_id = w.id) AS capitulos,
         (SELECT COALESCE(SUM(d.palavras), 0) FROM studio_pub_docs d WHERE d.work_id = w.id) AS palavras
       FROM studio_works w JOIN users u ON u.id = w.user_id LEFT JOIN profiles p ON p.slug = u.slug AND p.published = 1
       WHERE w.deleted_at IS NULL AND w.pub_slug IS NOT NULL AND ${VISIVEL} ORDER BY w.published_at DESC LIMIT 48`
    ).bind(agora).all();
    return h.json({
      obras: r.results.map((w) => ({
        ...resumo(w, { autor: { slug: w.autor, nome: nomeDoAutor(w.pdata) }, url: `ler.html?a=${encodeURIComponent(w.autor)}&o=${encodeURIComponent(w.pub_slug)}` }),
        capitulos: w.capitulos, palavras: w.palavras,
      })),
    });
  }

  const m = path.match(/^\/api\/leitura\/([^/]+)\/([^/]+)(?:\/(\d{1,5}))?$/);
  if (!m) return null;
  const [, autor, slug, n] = m;
  if (!SLUG_RE.test(autor) || !OBRA_SLUG_RE.test(slug)) return h.fail('Obra não encontrada.', 404);
  const w = await env.DB.prepare(
    `SELECT w.id, w.title, w.pub_slug, w.pub_meta, w.pub_version, w.published_at, p.data AS pdata
     FROM studio_works w JOIN users u ON u.id = w.user_id LEFT JOIN profiles p ON p.slug = u.slug
     WHERE u.slug = ? AND w.pub_slug = ? AND w.deleted_at IS NULL AND ${VISIVEL}`
  ).bind(autor, slug, agora).first();
  if (!w) return h.fail('Obra não encontrada.', 404);

  if (!n) {
    const caps = await env.DB.prepare('SELECT ordem, titulo, palavras FROM studio_pub_docs WHERE work_id = ? ORDER BY ordem').bind(w.id).all();
    return h.json({
      ...resumo(w), autor: { slug: autor, nome: nomeDoAutor(w.pdata) },
      capitulos: caps.results.map((c) => ({ n: c.ordem, titulo: c.titulo, palavras: c.palavras })),
      palavras: caps.results.reduce((s, c) => s + c.palavras, 0),
    });
  }
  const cap = await env.DB.prepare('SELECT ordem, doc_id, titulo, corpo FROM studio_pub_docs WHERE work_id = ? AND ordem = ?').bind(w.id, Number(n)).first();
  if (!cap) return h.fail('Capítulo não encontrado.', 404);
  const total = await env.DB.prepare('SELECT COUNT(*) AS n FROM studio_pub_docs WHERE work_id = ?').bind(w.id).first();
  return h.json({
    // conversa: id fixo do capitulo (nao muda se o autor inserir ou reordenar capitulos ao republicar)
    n: cap.ordem, conversa: `${w.id}-${cap.doc_id}`, titulo: cap.titulo, corpo: limparPrivado(cap.corpo), total: total.n,
    anterior: cap.ordem > 1 ? cap.ordem - 1 : null, proximo: cap.ordem < total.n ? cap.ordem + 1 : null,
    obra: { titulo: safe(w.pub_meta).titulo || w.title, slug, autor: { slug: autor, nome: nomeDoAutor(w.pdata) } },
  });
}
