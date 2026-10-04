// Entrelinhas: API de perfis de autor (Cloudflare Worker + D1).
// Rotas /api/* e /img/* passam por aqui; o resto vem dos arquivos estaticos.

import { studioApi, FAIXAS } from './studio.js';
import { leituraPublica, publicadasDoAutor, obraPublicada } from './leitura.js';
import { movimentosDaLixeira, naLixeira, listarLixeira, restaurar, excluirDefinitivo, limparLixeiraVencida } from './lixeira.js';
import { listarAjuda, criarPedido, fecharPedido, ofertar, desistir, decidirOferta } from './ajuda.js';
import { getLivro, putLivro, imagensDasPaginas, visitarLivro, favoritarLivro, criarPost, apagarPost, curtirPost } from './livro.js';
import { vitrine, livrosPublicos } from './vitrine.js';
import { verLeitor, salvarLeitor, seguir, estantes, criarLista, mudarLista, apagarLista, alternarLivro } from './leitor.js';
import { denunciarLivro, denunciasAbertas, listarDenunciasLivros, decidirDenunciaLivro } from './denuncias.js';

const SESSION_DAYS = 30;
const PBKDF2_ITER = 100000; // maximo permitido pelo Workers
const MAX_IMG = 600 * 1024;
const MAX_IMGS_PER_USER = 80; // perfil, capas, personagens e galerias das paginas de livro
const FAIL_LIMIT = 8;
const FAIL_WINDOW = 15 * 60;
const FUNDOS = ['preto', 'azul', 'vinho', 'verde', 'grafite'];
const STATUS = ['Publicado', 'Em desenvolvimento', 'Em escrita', 'Revisão', 'Em breve'];
const SERVICOS = ['beta', 'critica', 'divulgacao', 'capa']; // chaves de "Serviços que ofereço"
const SHORT_SESSION_HOURS = 12;
const IMG_TYPES = { 'image/jpeg': 1, 'image/png': 1, 'image/webp': 1 };

const now = () => Math.floor(Date.now() / 1000);

const json = (obj, status = 200, headers = {}) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers },
  });
const fail = (msg, status = 400) => json({ erro: msg }, status);

// ---------- cripto ----------
const enc = new TextEncoder();
const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const rand = (n) => crypto.getRandomValues(new Uint8Array(n));
const sha256Hex = async (s) => toHex(await crypto.subtle.digest('SHA-256', enc.encode(s)));

async function hashPassword(password, saltBytes) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations: PBKDF2_ITER }, key, 256);
  return b64(bits);
}
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// ---------- cookies e sessao ----------
function getCookie(req, name) {
  const m = (req.headers.get('Cookie') || '').match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return m ? m[1] : null;
}
const cookie = (value, maxAge) => `sid=${value}; HttpOnly; Secure; SameSite=Strict; Path=/${maxAge == null ? '' : '; Max-Age=' + maxAge}`;

async function newSession(env, userId, lembrar = true) {
  const token = toHex(rand(32));
  const ttl = lembrar ? SESSION_DAYS * 86400 : SHORT_SESSION_HOURS * 3600;
  await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(await sha256Hex(token), userId, now() + ttl).run();
  // sem "continuar conectado": cookie de sessao (some ao fechar o navegador) e validade curta no servidor
  return cookie(token, lembrar ? ttl : null);
}
async function currentUser(env, req) {
  const t = getCookie(req, 'sid');
  if (!t) return null;
  const row = await env.DB.prepare(
    'SELECT u.id, u.email, u.slug, u.is_admin, u.role, u.nome FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?'
  ).bind(await sha256Hex(t), now()).first();
  return row || null;
}

// ---------- limite de tentativas ----------
async function tooManyFails(env, key) {
  await env.DB.prepare('DELETE FROM login_fails WHERE at < ?').bind(now() - 86400).run();
  const r = await env.DB.prepare('SELECT COUNT(*) AS n FROM login_fails WHERE key = ? AND at > ?').bind(key, now() - FAIL_WINDOW).first();
  return r.n >= FAIL_LIMIT;
}
// limite geral de escritas: toda rota que muda algo (Estudio, favoritos, curtidas, seguir, estantes...).
// Conta por sessao (ou por IP, sem login) no Rate Limiting do Cloudflare (wrangler.jsonc: ratelimits ESCRITAS).
// Sem a ligacao (testes locais) nao limita. Se o limitador falhar, deixa passar: ele protege, nao derruba o site.
async function excedeuEscritas(env, req) {
  if (!env.ESCRITAS) return false;
  const sid = getCookie(req, 'sid');
  const chave = sid ? 's:' + (await sha256Hex(sid)).slice(0, 32) : 'ip:' + (req.headers.get('CF-Connecting-IP') || '?');
  try { return !(await env.ESCRITAS.limit({ key: chave })).success; } catch { return false; }
}
const recordFail = (env, key) => env.DB.prepare('INSERT INTO login_fails (key, at) VALUES (?, ?)').bind(key, now()).run();

// ---------- validacao ----------
const str = (v, max) => (typeof v === 'string' ? v.replace(/\u0000/g, '').trim().slice(0, max) : '');
const isEmail = (e) => /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(e) && e.length <= 254;
const isUrl = (u) => {
  try { const x = new URL(u); return (x.protocol === 'https:' || x.protocol === 'http:') && u.length <= 300; } catch { return false; }
};
const slugify = (s) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);

async function ownsImage(env, id, userId) {
  if (/^\/autor\/[a-z0-9._-]+\.(jpg|png|webp)$/.test(id)) return true; // imagens estaticas do site
  if (!/^[a-f0-9]{24}$/.test(id)) return false;
  const r = await env.DB.prepare('SELECT user_id FROM images WHERE id = ?').bind(id).first();
  return !!r && (r.user_id === userId || r.user_id === null);
}

async function sanitizeProfile(env, d, userId) {
  if (!d || typeof d !== 'object') throw new Error('Dados inválidos.');
  const out = {
    nome: str(d.nome, 80),
    frase: str(d.frase, 160),
    bio: str(d.bio, 1200),
    citacao: str(d.citacao, 200),
    local: str(d.local, 80),
    cor: /^#[0-9a-fA-F]{6}$/.test(d.cor || '') ? d.cor.toLowerCase() : '#d9a94a',
    fundo: FUNDOS.includes(d.fundo) ? d.fundo : 'preto',
    retrato: '',
    servicos: (Array.isArray(d.servicos) ? d.servicos : []).filter((k, i, a) => SERVICOS.includes(k) && a.indexOf(k) === i),
    links: [],
    secoes: [],
    obras: [],
  };
  if (!out.nome) throw new Error('O nome é obrigatório.');
  if (d.retrato && (await ownsImage(env, d.retrato, userId))) out.retrato = d.retrato;
  for (const l of (Array.isArray(d.links) ? d.links : []).slice(0, 8)) {
    const rotulo = str(l && l.rotulo, 40), url = str(l && l.url, 300);
    if (rotulo && isUrl(url)) out.links.push({ rotulo, url });
  }
  for (const s of (Array.isArray(d.secoes) ? d.secoes : []).slice(0, 8)) {
    const titulo = str(s && s.titulo, 80), texto = str(s && s.texto, 4000);
    if (titulo || texto) out.secoes.push({ titulo, texto });
  }
  const obraIds = new Set();
  for (const o of (Array.isArray(d.obras) ? d.obras : []).slice(0, 20)) {
    const titulo = str(o && o.titulo, 120);
    if (!titulo) continue;
    // id estavel da obra (as reviews apontam para ele); gera um novo se vier ausente, invalido ou repetido
    const id = typeof o.id === 'string' && /^[a-f0-9]{12}$/.test(o.id) && !obraIds.has(o.id) ? o.id : toHex(rand(6));
    obraIds.add(id);
    const obra = {
      id,
      titulo,
      genero: str(o.genero, 60),
      status: STATUS.includes(o.status) ? o.status : 'Publicado',
      sinopse: str(o.sinopse, 1500),
      faixa: FAIXAS.includes(o.faixa) ? o.faixa : '',
      // ano (AAAA) ou mes (AAAA-MM) em que o livro saiu
      publicado_em: /^(19|20)\d{2}(-(0[1-9]|1[0-2]))?$/.test(str(o.publicado_em, 7)) ? str(o.publicado_em, 7) : '',
      capa: '',
      link: isUrl(str(o.link, 300)) ? str(o.link, 300) : '',
      lojas: [], // outros locais de venda: [{ rotulo, url }]
    };
    for (const l of (Array.isArray(o.lojas) ? o.lojas : []).slice(0, 6)) {
      const rotulo = str(l && l.rotulo, 40), url = str(l && l.url, 300);
      if (rotulo && isUrl(url)) obra.lojas.push({ rotulo, url });
    }
    if (o.capa && (await ownsImage(env, o.capa, userId))) obra.capa = o.capa;
    out.obras.push(obra);
  }
  if (JSON.stringify(out).length > 60000) throw new Error('Perfil grande demais.');
  return out;
}

function defaultProfile(nome) {
  return { nome, frase: '', servicos: [], bio: '', citacao: '', local: '', cor: '#d9a94a', fundo: 'preto', retrato: '', links: [], secoes: [], obras: [] };
}

// ---------- rotas ----------
async function body(req) {
  try { return await req.json(); } catch { return null; }
}

async function register(env, req) {
  const b = await body(req);
  if (!b) return fail('Requisição inválida.');
  const ip = req.headers.get('CF-Connecting-IP') || 'x';
  const key = 'reg|' + ip;
  if (await tooManyFails(env, key)) return fail('Muitas tentativas. Tente de novo mais tarde.', 429);

  const email = str(b.email, 254).toLowerCase();
  const senha = typeof b.senha === 'string' ? b.senha : '';
  const nome = str(b.nome, 80);
  if (!isEmail(email)) return fail('E-mail inválido.');
  if (senha.length < 10 || senha.length > 200) return fail('A senha precisa ter pelo menos 10 caracteres.');

  const codeHash = await sha256Hex(str(b.convite, 100).toUpperCase());
  const inv = await env.DB.prepare('SELECT claim_slug, used_by, reusable, expires_at FROM invites WHERE code_hash = ?').bind(codeHash).first();
  if (!inv || (inv.used_by && !inv.reusable)) { await recordFail(env, key); return fail('Convite inválido ou já usado.', 403); }
  if (inv.expires_at && inv.expires_at < now()) return fail('Este convite expirou. Peça um novo a um moderador.', 403);

  let slug, claimed = false;
  if (inv.claim_slug) {
    const p = await env.DB.prepare('SELECT user_id FROM profiles WHERE slug = ?').bind(inv.claim_slug).first();
    if (!p || p.user_id) return fail('Este perfil já tem dono.', 409);
    slug = inv.claim_slug; claimed = true;
  } else {
    if (!nome) return fail('Informe seu nome.');
    const base = slugify(nome) || 'autor';
    slug = base;
    for (let i = 2; await env.DB.prepare('SELECT 1 FROM profiles WHERE slug = ?').bind(slug).first(); i++) slug = `${base}-${i}`;
  }
  if (await env.DB.prepare('SELECT 1 FROM users WHERE email = ?').bind(email).first()) return fail('Este e-mail já está cadastrado.', 409);

  const salt = rand(16);
  const hash = await hashPassword(senha, salt);
  const res = await env.DB.prepare('INSERT INTO users (email, pass_hash, pass_salt, slug, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(email, hash, b64(salt), slug, now()).run();
  const userId = res.meta.last_row_id;
  if (inv.reusable) await recordFail(env, key); // convite universal: cada cadastro conta no limite por IP
  else await env.DB.prepare('UPDATE invites SET used_by = ? WHERE code_hash = ?').bind(userId, codeHash).run();
  if (claimed) {
    await env.DB.prepare('UPDATE profiles SET user_id = ? WHERE slug = ?').bind(userId, slug).run();
  } else {
    await env.DB.prepare('INSERT INTO profiles (slug, user_id, data, badges, published, updated_at) VALUES (?, ?, ?, ?, 1, ?)')
      .bind(slug, userId, JSON.stringify(defaultProfile(nome)), '[]', now()).run();
  }
  return json({ ok: true, slug }, 200, { 'Set-Cookie': await newSession(env, userId) });
}

// Turnstile (captcha do Cloudflare). So e exigido quando o segredo esta configurado (producao);
// sem ele (desenvolvimento local) o cadastro segue sem captcha.
async function turnstileOk(env, token, ip) {
  if (!env.TURNSTILE_SECRET) return true;
  if (typeof token !== 'string' || !token || token.length > 2048) return false;
  try {
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token, remoteip: ip }),
    });
    const d = await r.json();
    return d.success === true;
  } catch { return false; }
}

// cadastro aberto de leitor: sem convite, sem perfil publico. Cada cadastro conta no limite por IP.
async function registerLeitor(env, req) {
  const b = await body(req);
  if (!b) return fail('Requisição inválida.');
  const ip = req.headers.get('CF-Connecting-IP') || 'x';
  const key = 'rl|' + ip;
  if (await tooManyFails(env, key)) return fail('Muitas tentativas. Tente de novo mais tarde.', 429);
  if (!(await turnstileOk(env, b.turnstile, ip))) return fail('Confirme que você não é um robô e tente de novo.', 400);

  const email = str(b.email, 254).toLowerCase();
  const senha = typeof b.senha === 'string' ? b.senha : '';
  const nome = str(b.nome, 40);
  if (nome.length < 2) return fail('Informe seu nome (pelo menos 2 letras).');
  if (!isEmail(email)) return fail('E-mail inválido.');
  if (senha.length < 10 || senha.length > 200) return fail('A senha precisa ter pelo menos 10 caracteres.');
  if (await env.DB.prepare('SELECT 1 FROM users WHERE email = ?').bind(email).first()) return fail('Este e-mail já está cadastrado.', 409);

  const salt = rand(16);
  const hash = await hashPassword(senha, salt);
  const slug = 'leitor-' + toHex(rand(5));
  const res = await env.DB.prepare('INSERT INTO users (email, pass_hash, pass_salt, slug, created_at, role, nome) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(email, hash, b64(salt), slug, now(), 'leitor', nome).run();
  await recordFail(env, key);
  return json({ ok: true, slug }, 200, { 'Set-Cookie': await newSession(env, res.meta.last_row_id) });
}

async function login(env, req) {
  const b = await body(req);
  if (!b) return fail('Requisição inválida.');
  const ip = req.headers.get('CF-Connecting-IP') || 'x';
  const email = str(b.email, 254).toLowerCase();
  const keys = ['ip|' + ip, 'em|' + email];
  for (const k of keys) if (await tooManyFails(env, k)) return fail('Muitas tentativas. Tente de novo em alguns minutos.', 429);

  const user = await env.DB.prepare('SELECT id, pass_hash, pass_salt, slug FROM users WHERE email = ?').bind(email).first();
  const salt = user ? unb64(user.pass_salt) : rand(16); // custo igual com e sem usuario
  const h = await hashPassword(typeof b.senha === 'string' ? b.senha.slice(0, 200) : '', salt);
  if (!user || !safeEqual(h, user.pass_hash)) {
    for (const k of keys) await recordFail(env, k);
    return fail('E-mail ou senha incorretos.', 401);
  }
  return json({ ok: true, slug: user.slug }, 200, { 'Set-Cookie': await newSession(env, user.id) });
}

async function logout(env, req) {
  const t = getCookie(req, 'sid');
  if (t) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256Hex(t)).run();
  return json({ ok: true }, 200, { 'Set-Cookie': cookie('', 0) });
}

async function changePassword(env, req, user) {
  const b = await body(req);
  if (!b || typeof b.nova !== 'string' || b.nova.length < 10 || b.nova.length > 200) return fail('A nova senha precisa ter pelo menos 10 caracteres.');
  const row = await env.DB.prepare('SELECT pass_hash, pass_salt FROM users WHERE id = ?').bind(user.id).first();
  const h = await hashPassword(typeof b.atual === 'string' ? b.atual.slice(0, 200) : '', unb64(row.pass_salt));
  if (!safeEqual(h, row.pass_hash)) return fail('Senha atual incorreta.', 401);
  const salt = rand(16);
  await env.DB.prepare('UPDATE users SET pass_hash = ?, pass_salt = ? WHERE id = ?').bind(await hashPassword(b.nova, salt), b64(salt), user.id).run();
  // encerra as outras sessoes; mantem a atual
  const cur = await sha256Hex(getCookie(req, 'sid') || '');
  await env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').bind(user.id, cur).run();
  return json({ ok: true });
}

// ---------- apagar conta (LGPD) ----------
// Exige a senha e a palavra APAGAR. Tudo num lote so (o D1 executa o batch como transacao).
// Autor: some o perfil publico, as obras (perfil e Estudio), imagens, paginas de livro e tudo que
// leitores deixaram nessas obras (avaliacoes, favoritos, visualizacoes, denuncias).
// Mensagens no chat da moderacao ficam, sem autor (ON DELETE SET NULL).
async function deleteAccount(env, req, user) {
  const b = await body(req);
  if (!b || b.confirmar !== 'APAGAR') return fail('Digite APAGAR para confirmar.');
  const row = await env.DB.prepare('SELECT pass_hash, pass_salt FROM users WHERE id = ?').bind(user.id).first();
  const h = await hashPassword(typeof b.senha === 'string' ? b.senha.slice(0, 200) : '', unb64(row.pass_salt));
  if (!safeEqual(h, row.pass_hash)) return fail('Senha incorreta.', 401);

  const obras = new Set();
  const p = await env.DB.prepare('SELECT data FROM profiles WHERE user_id = ?').bind(user.id).first();
  try { for (const o of JSON.parse(p ? p.data : '{}').obras || []) if (o.id) obras.add(o.id); } catch { /* perfil invalido */ }
  for (const w of (await env.DB.prepare('SELECT id FROM studio_works WHERE user_id = ?').bind(user.id).all()).results) obras.add(w.id);
  for (const l of await naLixeira(env, user.id)) obras.add(l.id);
  const ids = [...obras];

  const st = (sql, ...a) => env.DB.prepare(sql).bind(...a);
  const porObra = (sql) => ids.map((id) => st(sql, id));
  await env.DB.batch([
    ...porObra('DELETE FROM book_favorites WHERE obra_id = ?'),
    ...porObra('DELETE FROM book_views WHERE obra_id = ?'),
    ...porObra('DELETE FROM book_reports WHERE obra_id = ?'),
    ...porObra('DELETE FROM reader_list_items WHERE obra_id = ?'),
    st('DELETE FROM follows WHERE seguido_slug = ?', user.slug),
    st('DELETE FROM reviews WHERE author_slug = ?', user.slug),
    st('DELETE FROM profiles WHERE user_id = ? OR slug = ?', user.id, user.slug),
    st('DELETE FROM images WHERE user_id = ?', user.id),
    st('UPDATE invites SET used_by = NULL WHERE used_by = ?', user.id),
    st("DELETE FROM login_fails WHERE key = 'em|' || ?", user.email),
    st('DELETE FROM users WHERE id = ?', user.id), // o resto sai em cascata (sessoes, Estudio, reviews feitas, favoritos, ajuda...)
  ]);
  return json({ ok: true }, 200, { 'Set-Cookie': cookie('', 0) });
}

// ---------- recuperacao de senha ----------
// Modo 1: moderador gera o link e entrega por um canal confiavel. Modo 2: a pessoa pede pelo e-mail
// (so envia se RESEND_API_KEY existir). O banco guarda so o hash do token; link de uso unico, 30 min.
const RESET_TTL = 30 * 60;

async function criarLinkReset(env, userId, origem) {
  const token = toHex(rand(32));
  // um link valido por vez: pedir de novo invalida os anteriores
  await env.DB.prepare('DELETE FROM password_resets WHERE user_id = ? OR expires_at < ?').bind(userId, now()).run();
  await env.DB.prepare('INSERT INTO password_resets (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .bind(await sha256Hex(token), userId, now() + RESET_TTL, now()).run();
  return `${origem}/redefinir.html?token=${token}`;
}

async function adminResetLink(env, req, user) {
  if (!user.is_admin) return fail('Apenas moderadores.', 403);
  const b = await body(req);
  if (!b) return fail('Requisição inválida.');
  const u = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(str(b.email, 254).toLowerCase()).first();
  if (!u) return fail('Nenhuma conta com esse e-mail.', 404);
  return json({ link: await criarLinkReset(env, u.id, new URL(req.url).origin), expira_em_min: RESET_TTL / 60 });
}

// resposta sempre igual, exista a conta ou nao (nao revela quem tem cadastro)
async function requestReset(env, req) {
  const b = await body(req);
  if (!b) return fail('Requisição inválida.');
  const ip = req.headers.get('CF-Connecting-IP') || 'x';
  const email = str(b.email, 254).toLowerCase();
  const generico = json({ ok: true, email: !!env.RESEND_API_KEY });
  const keys = ['rp|' + ip, 'rp|' + email];
  for (const k of keys) if (await tooManyFails(env, k)) return generico;
  for (const k of keys) await recordFail(env, k);
  if (!isEmail(email) || !env.RESEND_API_KEY) return generico;
  const u = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (u) await enviarEmailReset(env, email, await criarLinkReset(env, u.id, new URL(req.url).origin));
  return generico;
}

async function doReset(env, req) {
  const b = await body(req);
  if (!b) return fail('Requisição inválida.');
  const nova = typeof b.nova === 'string' ? b.nova : '';
  if (nova.length < 10 || nova.length > 200) return fail('A senha precisa ter pelo menos 10 caracteres.');
  const th = await sha256Hex(str(b.token, 64));
  const row = await env.DB.prepare('SELECT user_id, expires_at, used FROM password_resets WHERE token_hash = ?').bind(th).first();
  if (!row || row.used || row.expires_at < now()) return fail('Este link é inválido ou expirou. Peça um novo.', 400);
  // marca como usado ANTES de trocar: dois envios simultaneos nao usam o mesmo link
  const mark = await env.DB.prepare('UPDATE password_resets SET used = 1 WHERE token_hash = ? AND used = 0').bind(th).run();
  if (!mark.meta || mark.meta.changes !== 1) return fail('Este link é inválido ou expirou. Peça um novo.', 400);
  const salt = rand(16);
  await env.DB.prepare('UPDATE users SET pass_hash = ?, pass_salt = ? WHERE id = ?').bind(await hashPassword(nova, salt), b64(salt), row.user_id).run();
  await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(row.user_id).run(); // derruba sessoes antigas
  await env.DB.prepare("DELETE FROM login_fails WHERE key = 'em|' || (SELECT email FROM users WHERE id = ?)").bind(row.user_id).run();
  return json({ ok: true });
}

async function enviarEmailReset(env, email, link) {
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: env.RESET_FROM || 'Entrelinhas <nao-responda@entrelinhasbr.com.br>',
        to: email,
        subject: 'Redefinir sua senha — Entrelinhas',
        text: `Recebemos um pedido para redefinir sua senha.\n\nCrie uma nova senha neste link (vale 30 minutos):\n${link}\n\nSe não foi você, ignore este e-mail.`,
      }),
    });
  } catch { /* falha de envio nao vaza para quem pediu */ }
}

// ---------- convites (painel de moderacao) ----------
// Codigo de uso unico, valido por 14 dias. So o hash vai para o banco: o codigo aparece uma vez, para o moderador.
const CONVITE_DIAS = 14;
const ALF = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem I, O, 0, 1 (faceis de confundir)

async function criarConvite(env, req, user) {
  if (!user.is_admin) return fail('Apenas moderadores.', 403);
  const b = (await body(req)) || {};
  const recentes = await env.DB.prepare('SELECT COUNT(*) AS n FROM invites WHERE created_by = ? AND created_at > ?').bind(user.id, now() - 86400).first();
  if (recentes.n >= 30) return fail('Limite de 30 convites por dia atingido.', 429);
  const pick = (n) => [...rand(n)].map((x) => ALF[x % ALF.length]).join('');
  const codigo = `${pick(5)}-${pick(5)}-${pick(5)}`;
  const t = now();
  await env.DB.prepare('INSERT INTO invites (code_hash, claim_slug, reusable, created_at, created_by, para, expires_at) VALUES (?, NULL, 0, ?, ?, ?, ?)')
    .bind(await sha256Hex(codigo), t, user.id, str(b.para, 80), t + CONVITE_DIAS * 86400).run();
  return json({ codigo, link: `${new URL(req.url).origin}/conta.html#convite=${codigo}`, expira_em_dias: CONVITE_DIAS });
}

async function listarConvites(env, req) {
  const u = await currentUser(env, req);
  if (!u || !u.is_admin) return fail('Apenas moderadores.', 403);
  const r = await env.DB.prepare(
    `SELECT i.para, i.created_at, i.expires_at, i.used_by, uu.slug AS usado_slug,
       COALESCE(NULLIF(c.nome, ''), json_extract(cp.data, '$.nome'), c.slug) AS criador
     FROM invites i LEFT JOIN users c ON c.id = i.created_by LEFT JOIN profiles cp ON cp.user_id = c.id LEFT JOIN users uu ON uu.id = i.used_by
     WHERE i.created_by IS NOT NULL ORDER BY i.created_at DESC LIMIT 20`
  ).all();
  return json(r.results.map((i) => ({
    para: i.para, criado_em: i.created_at, por: i.criador,
    situacao: i.used_by ? 'usado' : i.expires_at && i.expires_at < now() ? 'expirado' : 'aberto', usado_por: i.usado_slug || null,
  })));
}

// lista de contas para o painel de moderacao (recuperacao de senha)
async function adminAccounts(env, req) {
  const u = await currentUser(env, req);
  if (!u || !u.is_admin) return fail('Apenas moderadores.', 403);
  const rows = await env.DB.prepare(
    'SELECT u.email, u.slug, u.role, u.nome, u.is_admin, p.data FROM users u LEFT JOIN profiles p ON p.user_id = u.id ORDER BY u.role, u.id'
  ).all();
  return json(rows.results.map((r) => {
    let nome = r.nome || r.slug;
    try { nome = JSON.parse(r.data || '{}').nome || nome; } catch { /* perfil sem json */ }
    return { email: r.email, slug: r.slug, nome, role: r.role, mod: !!r.is_admin };
  }));
}

async function getProfile(env, slug, publicacao) {
  const p = await env.DB.prepare(
    'SELECT p.slug, p.data, p.badges, p.published, COALESCE(u.is_admin, 0) AS mod FROM profiles p LEFT JOIN users u ON u.id = p.user_id WHERE p.slug = ?'
  ).bind(slug).first();
  if (!p || !p.published) return null;
  const data = JSON.parse(p.data);
  // obras cadastradas antes das reviews nao tem id: atribui agora e grava (id estavel dai em diante)
  let changed = false;
  for (const o of data.obras || []) if (!o.id) { o.id = toHex(rand(6)); changed = true; }
  if (changed) await env.DB.prepare('UPDATE profiles SET data = ? WHERE slug = ?').bind(JSON.stringify(data), slug).run();
  // nota media e total de reviews por obra (so na resposta, nao e gravado)
  const agg = await env.DB.prepare('SELECT obra_id, COUNT(*) AS n, AVG(nota) AS media FROM reviews WHERE author_slug = ? AND hidden = 0 GROUP BY obra_id').bind(slug).all();
  const byObra = new Map(agg.results.map((r) => [r.obra_id, r]));
  for (const o of data.obras || []) {
    const a = byObra.get(o.id);
    o.reviews = { total: a ? a.n : 0, media: a ? Math.round(a.media * 10) / 10 : 0 };
  }
  // obras publicadas pelo Estudio (copia publica), com a mesma nota media das reviews
  let publicadas = [];
  if (publicacao) {
    publicadas = await publicadasDoAutor(env, slug, now());
    for (const o of publicadas) {
      const a = byObra.get(o.id);
      o.reviews = { total: a ? a.n : 0, media: a ? Math.round(a.media * 10) / 10 : 0 };
    }
  }
  return { slug: p.slug, data, badges: JSON.parse(p.badges), mod: !!p.mod, publicadas };
}

// limpa imagens do autor sem uso (com mais de 1h, para nao apagar upload recem-feito)
async function limparImagens(env, userId, perfil) {
  if (!perfil) { const p = await env.DB.prepare('SELECT data FROM profiles WHERE user_id = ?').bind(userId).first(); try { perfil = JSON.parse(p.data); } catch { return; } }
  const used = new Set([perfil.retrato, ...(perfil.obras || []).map((o) => o.capa)].filter(Boolean));
  const capas = await env.DB.prepare('SELECT meta, pub_meta FROM studio_works WHERE user_id = ?').bind(userId).all();
  for (const w of capas.results) for (const j of [w.meta, w.pub_meta]) { try { const c = JSON.parse(j || '{}').capa; if (c) used.add(c); } catch { /* json invalido */ } }
  for (const id of await imagensDasPaginas(env, userId)) used.add(id);
  for (const l of await naLixeira(env, userId)) if (l.capa) used.add(l.capa); // capa de livro na lixeira volta ao restaurar
  const imgs = await env.DB.prepare('SELECT id FROM images WHERE user_id = ? AND created_at < ?').bind(userId, now() - 3600).all();
  for (const r of imgs.results) if (!used.has(r.id)) await env.DB.prepare('DELETE FROM images WHERE id = ?').bind(r.id).run();
}

async function saveProfile(env, req, user) {
  const b = await body(req);
  if (!b) return fail('Requisição inválida.');
  let data;
  try { data = await sanitizeProfile(env, b.data, user.id); } catch (e) { return fail(e.message); }
  // data em que cada livro entrou no site: definida pelo servidor (o autor nao altera). Livro novo = agora;
  // livro que ja existia mantem a data gravada (os antigos, de antes deste campo, ficam sem data).
  const antes = await env.DB.prepare('SELECT data FROM profiles WHERE slug = ?').bind(user.slug).first();
  const noSite = new Map();
  let obrasAntes = [];
  try { obrasAntes = JSON.parse(antes.data).obras || []; } catch { /* perfil antigo */ }
  for (const o of obrasAntes) if (o.id) noSite.set(o.id, o.no_site_em || 0);
  for (const o of data.obras) { const t = noSite.has(o.id) ? noSite.get(o.id) : now(); if (t) o.no_site_em = t; }
  // livro removido do perfil vai para a lixeira (lixeira.html), com avaliacoes e tudo ligado ao mesmo id
  await env.DB.batch([
    env.DB.prepare('UPDATE profiles SET data = ?, updated_at = ? WHERE slug = ?').bind(JSON.stringify(data), now(), user.slug),
    ...movimentosDaLixeira(env, user.id, obrasAntes, data.obras, now()),
  ]);
  await limparImagens(env, user.id, data);
  return json({ ok: true, data });
}

async function uploadImage(env, req, user) {
  if (Number(req.headers.get('Content-Length') || 0) > MAX_IMG) return fail('A imagem deve ter até 600 KB.');
  const type = (req.headers.get('Content-Type') || '').split(';')[0].trim();
  if (!IMG_TYPES[type]) return fail('Envie uma imagem JPEG, PNG ou WebP.');
  const buf = await req.arrayBuffer();
  if (buf.byteLength === 0 || buf.byteLength > MAX_IMG) return fail('A imagem deve ter até 600 KB.');
  const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM images WHERE user_id = ?').bind(user.id).first();
  if (n.n >= (user.role === 'autor' ? MAX_IMGS_PER_USER : 3)) return fail(user.role === 'autor' ? 'Limite de imagens atingido. Remova obras antigas.' : 'Limite de imagens atingido. Salve o perfil com a foto escolhida.');
  const id = toHex(rand(12));
  await env.DB.prepare('INSERT INTO images (id, user_id, mime, data, created_at) VALUES (?, ?, ?, ?, ?)').bind(id, user.id, type, buf, now()).run();
  return json({ ok: true, id });
}

async function serveImage(env, id) {
  if (!/^[a-f0-9]{24}$/.test(id)) return new Response('Not found', { status: 404 });
  const r = await env.DB.prepare('SELECT mime, data FROM images WHERE id = ?').bind(id).first();
  if (!r) return new Response('Not found', { status: 404 });
  // o D1 devolve BLOB como lista de numeros; converte para bytes
  const bytes = r.data instanceof ArrayBuffer ? r.data : new Uint8Array(r.data);
  return new Response(bytes, {
    headers: {
      'Content-Type': r.mime,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'",
    },
  });
}

// ---------- reviews ----------
const MOTIVOS = ['spoiler', 'ofensivo', 'spam'];
const SLUG_RE = /^[a-z0-9-]{1,40}$/;
const OBRA_RE = /^[a-f0-9]{12}$/;

async function obraExists(env, autor, obraId, publicacao) {
  const p = await env.DB.prepare('SELECT data FROM profiles WHERE slug = ? AND published = 1').bind(autor).first();
  if (p && (JSON.parse(p.data).obras || []).some((o) => o.id === obraId)) return true;
  return !!publicacao && obraPublicada(env, autor, obraId, now());
}

// publico: lista as reviews de uma obra. Se houver login, marca as proprias e os votos.
async function listReviews(env, req, url) {
  const autor = url.searchParams.get('autor') || '', obra = url.searchParams.get('obra') || '';
  if (!SLUG_RE.test(autor) || !OBRA_RE.test(obra)) return fail('Obra inválida.');
  const viewer = await currentUser(env, req);
  const rows = await env.DB.prepare(
    'SELECT r.id, r.nota, r.texto, r.spoiler, r.created_at, r.user_id, u.nome, u.role, u.slug AS uslug, p.data AS pdata, ' +
    '(SELECT COUNT(*) FROM review_votes v WHERE v.review_id = r.id) AS uteis, ' +
    '(SELECT COUNT(*) FROM review_votes v2 WHERE v2.review_id = r.id AND v2.user_id = ?) AS meu_voto, ' +
    '(SELECT COUNT(*) FROM review_reports d WHERE d.review_id = r.id) AS denuncias ' +
    'FROM reviews r JOIN users u ON u.id = r.user_id LEFT JOIN profiles p ON p.slug = u.slug ' +
    'WHERE r.author_slug = ? AND r.obra_id = ? AND r.hidden = 0 ORDER BY uteis DESC, r.created_at DESC LIMIT 100'
  ).bind(viewer ? viewer.id : 0, autor, obra).all();
  const agg = await env.DB.prepare('SELECT COUNT(*) AS n, AVG(nota) AS media FROM reviews WHERE author_slug = ? AND obra_id = ? AND hidden = 0').bind(autor, obra).first();
  return json({
    resumo: { total: agg.n, media: agg.n ? Math.round(agg.media * 10) / 10 : 0 },
    eu: viewer ? { mod: !!viewer.is_admin, role: viewer.role, dono: viewer.slug === autor } : null,
    reviews: rows.results.map((r) => ({
      id: r.id, nota: r.nota, texto: r.texto, spoiler: !!r.spoiler, em: r.created_at,
      nome: r.role === 'autor' ? (r.pdata ? JSON.parse(r.pdata).nome : '') || 'Autor' : r.nome || 'Leitor',
      perfil: r.role === 'autor' ? r.uslug : null,
      leitor: r.role === 'autor' ? null : r.uslug,
      uteis: r.uteis, meu_voto: !!r.meu_voto,
      minha: !!viewer && r.user_id === viewer.id,
      ...(viewer && viewer.is_admin ? { denuncias: r.denuncias } : {}),
    })),
  });
}

async function putReview(env, req, user, publicacao) {
  const b = await body(req);
  if (!b) return fail('Requisição inválida.');
  const rl = 'rv|' + user.id;
  if (await tooManyFails(env, rl)) return fail('Muitas avaliações em pouco tempo. Aguarde alguns minutos.', 429);
  const autor = typeof b.autor === 'string' ? b.autor : '', obra = typeof b.obra === 'string' ? b.obra : '';
  const nota = Number(b.nota), texto = str(b.texto, 3000);
  if (!SLUG_RE.test(autor) || !OBRA_RE.test(obra)) return fail('Obra inválida.');
  if (!Number.isInteger(nota) || nota < 1 || nota > 5) return fail('Escolha uma nota de 1 a 5.');
  if (texto.length < 10) return fail('Escreva pelo menos 10 caracteres na review.');
  if (user.slug === autor) return fail('Você não pode avaliar a sua própria obra.', 403);
  if (!(await obraExists(env, autor, obra, publicacao))) return fail('Obra não encontrada.', 404);
  const t = now();
  await env.DB.prepare(
    'INSERT INTO reviews (author_slug, obra_id, user_id, nota, texto, spoiler, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ' +
    'ON CONFLICT(author_slug, obra_id, user_id) DO UPDATE SET nota = excluded.nota, texto = excluded.texto, spoiler = excluded.spoiler, updated_at = excluded.updated_at'
  ).bind(autor, obra, user.id, nota, texto, b.spoiler ? 1 : 0, t, t).run();
  await recordFail(env, rl);
  return json({ ok: true });
}

async function deleteReview(env, user, id) {
  const r = await env.DB.prepare('SELECT user_id FROM reviews WHERE id = ?').bind(id).first();
  if (!r) return fail('Review não encontrada.', 404);
  if (r.user_id !== user.id && !user.is_admin) return fail('Sem permissão.', 403);
  await env.DB.prepare('DELETE FROM reviews WHERE id = ?').bind(id).run();
  return json({ ok: true });
}

async function toggleUtil(env, user, id) {
  const r = await env.DB.prepare('SELECT user_id FROM reviews WHERE id = ? AND hidden = 0').bind(id).first();
  if (!r) return fail('Review não encontrada.', 404);
  if (r.user_id === user.id) return fail('Você não pode votar na própria review.', 403);
  const has = await env.DB.prepare('SELECT 1 FROM review_votes WHERE review_id = ? AND user_id = ?').bind(id, user.id).first();
  if (has) await env.DB.prepare('DELETE FROM review_votes WHERE review_id = ? AND user_id = ?').bind(id, user.id).run();
  else await env.DB.prepare('INSERT INTO review_votes (review_id, user_id) VALUES (?, ?)').bind(id, user.id).run();
  const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM review_votes WHERE review_id = ?').bind(id).first();
  return json({ ok: true, uteis: n.n, meu_voto: !has });
}

async function reportReview(env, req, user, id) {
  const b = await body(req);
  const motivo = b && typeof b.motivo === 'string' ? b.motivo : '';
  if (!MOTIVOS.includes(motivo)) return fail('Escolha um motivo.');
  const r = await env.DB.prepare('SELECT user_id FROM reviews WHERE id = ?').bind(id).first();
  if (!r) return fail('Review não encontrada.', 404);
  if (r.user_id === user.id) return fail('Você não pode denunciar a própria review.', 403);
  await env.DB.prepare('INSERT OR REPLACE INTO review_reports (review_id, user_id, motivo, created_at) VALUES (?, ?, ?, ?)').bind(id, user.id, motivo, now()).run();
  return json({ ok: true });
}

// ---------- chat dos moderadores ----------
// is_admin = moderador. Todas as rotas de chat exigem login e moderacao.
async function requireMod(env, req) {
  const user = await currentUser(env, req);
  if (!user) return { err: fail('Faça login para continuar.', 401) };
  if (!user.is_admin) return { err: fail('Apenas moderadores acessam o chat.', 403) };
  return { user };
}

async function listChat(env, req, url) {
  const { user, err } = await requireMod(env, req);
  if (err) return err;
  const after = Math.max(0, parseInt(url.searchParams.get('after'), 10) || 0);
  const sql =
    'SELECT m.id, m.body, m.created_at, m.user_id, u.slug, p.data FROM chat_messages m ' +
    'LEFT JOIN users u ON u.id = m.user_id LEFT JOIN profiles p ON p.slug = u.slug WHERE m.id > ? ';
  // primeira carga: as ultimas 100; depois: so as novas
  const rows = after
    ? await env.DB.prepare(sql + 'ORDER BY m.id ASC LIMIT 100').bind(after).all()
    : await env.DB.prepare(sql + 'ORDER BY m.id DESC LIMIT 100').bind(0).all();
  const list = after ? rows.results : rows.results.reverse();
  return json({
    me: user.id,
    messages: list.map((r) => ({
      id: r.id, texto: r.body, em: r.created_at, meu: r.user_id === user.id,
      autor: r.data ? JSON.parse(r.data).nome || 'Moderador' : 'Ex-moderador',
    })),
  });
}

async function postChat(env, req, user) {
  if (!user.is_admin) return fail('Apenas moderadores acessam o chat.', 403);
  const b = await body(req);
  const texto = str(b && b.texto, 1000);
  if (!texto) return fail('Escreva uma mensagem.');
  const res = await env.DB.prepare('INSERT INTO chat_messages (user_id, body, created_at) VALUES (?, ?, ?)').bind(user.id, texto, now()).run();
  // guarda so as ultimas 1000 mensagens
  await env.DB.prepare('DELETE FROM chat_messages WHERE id <= ?').bind(res.meta.last_row_id - 1000).run();
  return json({ ok: true, id: res.meta.last_row_id });
}

async function deleteChat(env, user, id) {
  if (!user.is_admin) return fail('Apenas moderadores acessam o chat.', 403);
  await env.DB.prepare('DELETE FROM chat_messages WHERE id = ?').bind(id).run();
  return json({ ok: true });
}

export default {
  // tarefa diaria (wrangler.jsonc: triggers.crons): exclui de vez os livros com mais de 15 dias na lixeira
  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      for (const userId of await limparLixeiraVencida(env, now())) await limparImagens(env, userId);
    })());
  },

  async fetch(req, env) {
    const url = new URL(req.url);
    const path = url.pathname;

    // www.dominio -> dominio (redirecionamento permanente, preserva caminho e parametros)
    if (url.hostname.startsWith('www.')) {
      url.hostname = url.hostname.slice(4);
      return Response.redirect(url.toString(), 301);
    }

    if (path.startsWith('/img/') && req.method === 'GET') return serveImage(env, path.slice(5));
    if (!path.startsWith('/api/')) return env.ASSETS.fetch(req);

    // protecao CSRF: toda escrita exige cabecalho proprio (alem de cookie SameSite=Strict)
    if (req.method !== 'GET' && req.headers.get('X-Requested-With') !== 'fetch') return fail('Requisição não permitida.', 403);
    if (req.method !== 'GET' && await excedeuEscritas(env, req)) return fail('Muitas ações em pouco tempo. Espere um minuto e tente de novo.', 429);

    // publicacao do Estudio: so com a chave ligada (wrangler.jsonc: ESTUDIO_PUBLICACAO = "on")
    const publicacao = env.ESTUDIO_PUBLICACAO === 'on';

    try {
      // Estudio Entrelinhas (privado): autenticacao aqui, regras de dono dentro do modulo
      if (path.startsWith('/api/studio/')) {
        const su = await currentUser(env, req);
        if (!su) return fail('Faça login para continuar.', 401);
        return studioApi(req, env, url, su, { json, fail, str, body, now, rand, toHex });
      }

      if (req.method === 'GET') {
        if (path === '/api/me') {
          const u = await currentUser(env, req);
          if (!u) return fail('Não autenticado.', 401);
          // foto para o topo da pagina: leitor usa a do perfil de leitor; autor, o retrato do perfil de autor
          const ex = await env.DB.prepare(
            "SELECT u.foto, json_extract(p.data, '$.retrato') AS retrato, json_extract(p.data, '$.nome') AS pnome FROM users u LEFT JOIN profiles p ON p.user_id = u.id WHERE u.id = ?"
          ).bind(u.id).first();
          const autor = u.role === 'autor';
          return json({ slug: u.slug, email: u.email, mod: !!u.is_admin, role: u.role, nome: (autor && ex.pnome) || u.nome, foto: (autor ? ex.retrato : ex.foto) || '' });
        }
        if (path === '/api/reviews') return listReviews(env, req, url);
        // leitura publica das obras publicadas no Estudio
        if (path === '/api/biblioteca' || path.startsWith('/api/leitura/')) {
          if (!publicacao) return fail('Não encontrado.', 404);
          const r = await leituraPublica(req, env, url, { json, fail, now });
          if (r) return r;
        }
        // configuracao publica para o navegador (a chave do captcha nao e segredo)
        if (path === '/api/config') return json({ turnstile: env.TURNSTILE_SECRET ? env.TURNSTILE_SITEKEY || null : null, disqus: /^[a-z0-9-]{1,64}$/.test(env.DISQUS_SHORTNAME || '') ? env.DISQUS_SHORTNAME : null });
        if (path === '/api/authors') {
          const rows = await env.DB.prepare(
            'SELECT p.slug, p.data, p.badges, COALESCE(u.is_admin, 0) AS mod FROM profiles p LEFT JOIN users u ON u.id = p.user_id WHERE p.published = 1'
          ).all();
          const list = rows.results.map((r) => {
            const d = JSON.parse(r.data);
            return { slug: r.slug, nome: d.nome, frase: d.frase, retrato: d.retrato, cor: d.cor, badges: JSON.parse(r.badges), mod: !!r.mod };
          });
          // moderadores sempre no topo; dentro de cada grupo, ordem alfabetica (sem diferenciar acento/caixa)
          list.sort((a, b) => b.mod - a.mod || (a.nome || '').localeCompare(b.nome || '', 'pt-BR', { sensitivity: 'base' }));
          return json(list);
        }
        if (path === '/api/chat') return listChat(env, req, url);
        if (path === '/api/vitrine') return vitrine(env, { json, now, publicacao });
        const lt = path.match(/^\/api\/leitor\/([a-z0-9-]{1,40})$/);
        if (lt) return verLeitor(env, req, lt[1], { json, fail, now, currentUser, livros: () => livrosPublicos(env, { now, publicacao }) });
        const sg = path.match(/^\/api\/seguir\/([a-z0-9-]{1,40})$/);
        if (sg) return seguir(env, await currentUser(env, req), sg[1], false, { json, fail, now });
        if (path === '/api/estantes') {
          const u = await currentUser(env, req);
          return u ? estantes(env, u, { json, now }) : fail('Faça login para continuar.', 401);
        }
        if (path === '/api/admin/contas') return adminAccounts(env, req);
        const lv = path.match(/^\/api\/livro\/([a-z0-9-]{1,40})\/([a-f0-9]{12})$/);
        if (lv) return getLivro(env, req, lv[1], lv[2], { json, fail, now, currentUser, publicacao, denunciasAbertas });
        if (path === '/api/admin/denuncias-livros') {
          const u = await currentUser(env, req);
          if (!u || !u.is_admin) return fail('Apenas moderadores.', 403);
          return listarDenunciasLivros(env, url, { json });
        }
        if (path === '/api/admin/convites') return listarConvites(env, req);
        if (path === '/api/lixeira') {
          const u = await currentUser(env, req);
          if (!u) return fail('Faça login para continuar.', 401);
          return u.role === 'autor' ? listarLixeira(env, u, { json, now }) : fail('Apenas autores têm lixeira de livros.', 403);
        }
        if (path === '/api/ajuda') {
          const u = await currentUser(env, req);
          if (!u) return fail('Faça login para continuar.', 401);
          return u.role === 'autor' ? listarAjuda(env, u, { json }) : fail('A ajuda entre autores é para autores do coletivo.', 403);
        }
        const m = path.match(/^\/api\/profile\/([a-z0-9-]{1,40})$/);
        if (m) {
          const p = await getProfile(env, m[1], publicacao);
          return p ? json(p) : fail('Perfil não encontrado.', 404);
        }
        return fail('Não encontrado.', 404);
      }

      if (path === '/api/register' && req.method === 'POST') return register(env, req);
      if (path === '/api/register-leitor' && req.method === 'POST') return registerLeitor(env, req);
      if (path === '/api/login' && req.method === 'POST') return login(env, req);
      if (path === '/api/logout' && req.method === 'POST') return logout(env, req);
      if (path === '/api/recuperar' && req.method === 'POST') return requestReset(env, req);
      if (path === '/api/redefinir' && req.method === 'POST') return doReset(env, req);
      const vi = path.match(/^\/api\/livro\/([a-z0-9-]{1,40})\/([a-f0-9]{12})\/visita$/);
      if (vi && req.method === 'POST') return visitarLivro(env, req, vi[1], vi[2], { json, fail, now, currentUser, obraExists: (a, o) => obraExists(env, a, o, publicacao) });

      const user = await currentUser(env, req);
      if (!user) return fail('Faça login para continuar.', 401);
      if (path === '/api/profile' && req.method === 'PUT') return user.role === 'autor' ? saveProfile(env, req, user) : fail('Apenas autores editam perfil.', 403);
      if (path === '/api/image' && req.method === 'POST') return uploadImage(env, req, user);
      if (path === '/api/leitor' && req.method === 'PUT') return salvarLeitor(env, req, user, { json, fail, str, body, ownsImage });
      const sgp = path.match(/^\/api\/seguir\/([a-z0-9-]{1,40})$/);
      if (sgp && req.method === 'POST') return seguir(env, user, sgp[1], true, { json, fail, now });
      if (path === '/api/estantes' || path.startsWith('/api/estantes/')) {
        const he = { json, fail, str, body, now, obraExists: (a, o) => obraExists(env, a, o, publicacao) };
        if (path === '/api/estantes' && req.method === 'POST') return criarLista(env, req, user, he);
        const es = path.match(/^\/api\/estantes\/(\d{1,12})(\/livro)?$/);
        if (es && es[2] && req.method === 'POST') return alternarLivro(env, req, user, Number(es[1]), he);
        if (es && !es[2] && req.method === 'PATCH') return mudarLista(env, req, user, Number(es[1]), he);
        if (es && !es[2] && req.method === 'DELETE') return apagarLista(env, user, Number(es[1]), he);
        return fail('Não encontrado.', 404);
      }
      if (path === '/api/reviews' && req.method === 'PUT') return putReview(env, req, user, publicacao);
      const rm = path.match(/^\/api\/reviews\/(\d{1,12})(?:\/(util|denunciar))?$/);
      if (rm) {
        const rid = Number(rm[1]);
        if (!rm[2] && req.method === 'DELETE') return deleteReview(env, user, rid);
        if (rm[2] === 'util' && req.method === 'POST') return toggleUtil(env, user, rid);
        if (rm[2] === 'denunciar' && req.method === 'POST') return reportReview(env, req, user, rid);
      }
      if (path === '/api/password' && req.method === 'POST') return changePassword(env, req, user);
      if (path === '/api/conta/apagar' && req.method === 'POST') return deleteAccount(env, req, user);
      if (path === '/api/admin/reset-link' && req.method === 'POST') return adminResetLink(env, req, user);
      if (path === '/api/admin/convites' && req.method === 'POST') return criarConvite(env, req, user);
      const dl = path.match(/^\/api\/livro\/([a-z0-9-]{1,40})\/([a-f0-9]{12})\/denuncia$/);
      if (dl && req.method === 'POST') return denunciarLivro(env, req, user, dl[1], dl[2], { json, fail, str, body, now, isUrl, obraExists: (a, o) => obraExists(env, a, o, publicacao) });
      if (path === '/api/lixeira' || path.startsWith('/api/lixeira/')) {
        if (user.role !== 'autor') return fail('Apenas autores têm lixeira de livros.', 403);
        const lx = path.match(/^\/api\/lixeira\/([a-f0-9]{12})(\/restaurar)?$/);
        if (lx && lx[2] && req.method === 'POST') return restaurar(env, req, user, lx[1], { json, fail, now, str, body });
        if (lx && !lx[2] && req.method === 'DELETE') {
          const r = await excluirDefinitivo(env, user, lx[1], { json, fail });
          if (r.ok) await limparImagens(env, user.id);
          return r;
        }
        return fail('Não encontrado.', 404);
      }
      if (path === '/api/ajuda' || path.startsWith('/api/ajuda/')) {
        if (user.role !== 'autor') return fail('A ajuda entre autores é para autores do coletivo.', 403);
        const ha = { json, fail, str, body, now };
        if (path === '/api/ajuda' && req.method === 'POST') return criarPedido(env, req, user, ha);
        const aj = path.match(/^\/api\/ajuda\/(\d{1,12})\/(fechar|reabrir|oferta)(?:\/(\d{1,12}))?$/);
        if (aj) {
          const id = Number(aj[1]);
          if (aj[2] !== 'oferta' && !aj[3] && req.method === 'POST') return fecharPedido(env, user, id, aj[2] === 'reabrir', ha);
          if (aj[2] === 'oferta' && !aj[3] && req.method === 'POST') return ofertar(env, req, user, id, ha);
          if (aj[2] === 'oferta' && !aj[3] && req.method === 'DELETE') return desistir(env, user, id, ha);
          if (aj[2] === 'oferta' && aj[3] && req.method === 'POST') return decidirOferta(env, req, user, id, Number(aj[3]), ha);
        }
        return fail('Não encontrado.', 404);
      }
      const fv = path.match(/^\/api\/livro\/([a-z0-9-]{1,40})\/([a-f0-9]{12})\/favorito$/);
      if (fv && req.method === 'POST') return favoritarLivro(env, user, fv[1], fv[2], { json, fail, now, obraExists: (a, o) => obraExists(env, a, o, publicacao) });
      const ps = path.match(/^\/api\/livro\/([a-f0-9]{12})\/posts(?:\/(\d{1,12}))?$/);
      if (ps && !ps[2] && req.method === 'POST') return criarPost(env, req, user, ps[1], { json, fail, str, body, now, ownsImage });
      if (ps && ps[2] && req.method === 'DELETE') {
        const r = await apagarPost(env, user, ps[1], Number(ps[2]), { json, fail });
        if (r.ok) await limparImagens(env, user.id);
        return r;
      }
      const cp = path.match(/^\/api\/livro\/posts\/(\d{1,12})\/curtir$/);
      if (cp && req.method === 'POST') return curtirPost(env, user, Number(cp[1]), { json, fail });
      const dd = path.match(/^\/api\/admin\/denuncias-livros\/(\d{1,12})$/);
      if (dd && req.method === 'POST') return user.is_admin ? decidirDenunciaLivro(env, req, user, Number(dd[1]), { json, fail, str, body, now }) : fail('Apenas moderadores.', 403);
      const lp = path.match(/^\/api\/livro\/([a-f0-9]{12})$/);
      if (lp && req.method === 'PUT') {
        const r = await putLivro(env, req, user, lp[1], { json, fail, str, body, now, isUrl, ownsImage });
        if (r.ok) await limparImagens(env, user.id);
        return r;
      }
      if (path === '/api/chat' && req.method === 'POST') return postChat(env, req, user);
      const cm = path.match(/^\/api\/chat\/(\d{1,12})$/);
      if (cm && req.method === 'DELETE') return deleteChat(env, user, Number(cm[1]));
      return fail('Não encontrado.', 404);
    } catch (e) {
      return fail('Erro interno.', 500);
    }
  },
};
