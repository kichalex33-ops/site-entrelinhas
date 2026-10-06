// Confirmacao de e-mail: link de uso unico (48 h, so o hash no banco), reenvio com limite, contas antigas sem bloqueio
// e o que fica bloqueado enquanto o e-mail esta pendente. O Resend e simulado: nenhum e-mail sai de verdade.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { makeApp } from './helpers.mjs';

const sha = (s) => createHash('sha256').update(s).digest('hex');
const fetchOriginal = globalThis.fetch;
afterEach(() => { globalThis.fetch = fetchOriginal; });

// captura os e-mails que o Worker manda para a API do Resend
function caixaDeSaida() {
  const enviados = [];
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith('https://api.resend.com/')) { enviados.push(JSON.parse(init.body)); return new Response('{"id":"x"}', { status: 200 }); }
    return fetchOriginal(url, init);
  };
  return enviados;
}
const tokenDoEmail = (m) => m.text.match(/confirmar-email\.html\?token=([a-f0-9]{64})/)[1];
const COM_EMAIL = { RESEND_API_KEY: 're_teste' };
const leitorNovo = (app, email = 'lia@teste.local') =>
  app.call('POST', '/api/register-leitor', { body: { nome: 'Lia', email, senha: 'senha-segura-123', aceite: true } });
const sessao = (r) => r.headers.get('Set-Cookie').match(/sid=([a-f0-9]+)/)[1];

test('cadastro manda o link; confirmar libera a conta; o link nao vale duas vezes', async () => {
  const caixa = caixaDeSaida();
  const app = makeApp(COM_EMAIL);
  const r = await leitorNovo(app);
  assert.equal(r.s, 200); assert.equal(r.j.confirmar_email, true);
  assert.equal(caixa.length, 1); assert.equal(caixa[0].to, 'lia@teste.local');
  const token = tokenDoEmail(caixa[0]);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM email_confirmations WHERE token_hash = ?').get(token).n, 0, 'o token em claro nao vai para o banco');
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM email_confirmations WHERE token_hash = ?').get(sha(token)).n, 1);

  const tok = sessao(r);
  let me = (await app.call('GET', '/api/me', { tok })).j;
  assert.equal(me.email_status, 'pendente'); assert.equal(me.confirmar_email, true);

  const ok = await app.call('POST', '/api/email/confirmar', { body: { token } });
  assert.equal(ok.s, 200, JSON.stringify(ok.j));
  me = (await app.call('GET', '/api/me', { tok })).j;
  assert.equal(me.email_status, 'confirmado'); assert.equal(me.confirmar_email, false);
  assert.equal((await app.call('POST', '/api/email/confirmar', { body: { token } })).s, 400, 'uso unico');
});

test('token invalido ou expirado nao confirma', async () => {
  const caixa = caixaDeSaida();
  const app = makeApp(COM_EMAIL);
  await leitorNovo(app);
  assert.equal((await app.call('POST', '/api/email/confirmar', { body: { token: 'f'.repeat(64) } })).s, 400);
  assert.equal((await app.call('POST', '/api/email/confirmar', { body: {} })).s, 400);
  const token = tokenDoEmail(caixa[0]);
  app.db.prepare('UPDATE email_confirmations SET expires_at = 1').run();
  const r = await app.call('POST', '/api/email/confirmar', { body: { token } });
  assert.equal(r.s, 400); assert.match(r.j.erro, /expirou/);
  assert.equal(app.db.prepare("SELECT email_status FROM users WHERE email = 'lia@teste.local'").get().email_status, 'pendente');
});

test('reenvio: novo link invalida o anterior; no maximo 1 por minuto e 3 por hora', async () => {
  const caixa = caixaDeSaida();
  const app = makeApp(COM_EMAIL);
  const tok = sessao(await leitorNovo(app));
  const reenviar = () => app.call('POST', '/api/email/reenviar', { tok });
  assert.equal((await reenviar()).s, 429, 'menos de um minuto depois do cadastro');
  app.db.prepare('UPDATE email_confirmations SET created_at = created_at - 120').run();
  assert.equal((await reenviar()).s, 200);
  assert.equal(caixa.length, 2);
  assert.equal((await app.call('POST', '/api/email/confirmar', { body: { token: tokenDoEmail(caixa[0]) } })).s, 400, 'o link antigo deixou de valer');
  app.db.prepare('UPDATE email_confirmations SET created_at = created_at - 120').run();
  assert.equal((await reenviar()).s, 200);
  app.db.prepare('UPDATE email_confirmations SET created_at = created_at - 120').run();
  const r = await reenviar();
  assert.equal(r.s, 429, 'quarto envio na mesma hora'); assert.equal(caixa.length, 3);
  assert.equal((await app.call('POST', '/api/email/confirmar', { body: { token: tokenDoEmail(caixa[2]) } })).s, 200, 'o mais recente vale');
  assert.deepEqual((await reenviar()).j, { ok: true, ja_confirmado: true });
  assert.equal((await app.call('POST', '/api/email/reenviar')).s, 401, 'reenvio exige login');
});

test('pendente le, segue e monta estantes, mas nao avalia, nao denuncia e nao publica; confirmado sim', async () => {
  caixaDeSaida();
  const app = makeApp({ ...COM_EMAIL, ESTUDIO_PUBLICACAO: 'on' });
  const a = app.addUser({ nome: 'Ana' });
  const rp = await app.call('PUT', '/api/profile', { tok: a.tok, body: { data: { nome: 'Ana Autora', links: [], secoes: [], obras: [{ titulo: 'O Rio', status: 'Publicado' }] } } });
  const obra = rp.j.data.obras[0].id;
  const l = app.addUser({ role: 'leitor', nome: 'Lia', email_status: 'pendente' });

  assert.equal((await app.call('POST', `/api/seguir/${a.slug}`, { tok: l.tok })).s, 200, 'seguir continua livre');
  assert.equal((await app.call('POST', `/api/livro/${a.slug}/${obra}/favorito`, { tok: l.tok })).s, 200, 'favoritar continua livre');
  assert.equal((await app.call('PUT', '/api/leitor', { tok: l.tok, body: { nome: 'Lia Leitora', bio: 'oi' } })).s, 200, 'editar a conta continua livre');
  const av = await app.call('PUT', '/api/reviews', { tok: l.tok, body: { autor: a.slug, obra, nota: 5, texto: 'Li em uma noite so, recomendo.' } });
  assert.equal(av.s, 403); assert.equal(av.j.codigo, 'confirmar_email');
  assert.equal((await app.call('POST', `/api/livro/${a.slug}/${obra}/denuncia`, { tok: l.tok, body: { motivo: 'spam' } })).j.codigo, 'confirmar_email');

  // autor novo pendente: nao publica pelo Estudio
  const n = app.addUser({ nome: 'Nova', email_status: 'pendente' });
  const w = (await app.call('POST', '/api/studio/works', { tok: n.tok, body: { titulo: 'Novo' } })).j.id;
  assert.ok(w, 'escrever no Estudio continua livre');
  const pub = await app.call('POST', `/api/studio/works/${w}/publicacao`, { tok: n.tok, body: { acao: 'publicar', aceite: 2 } });
  assert.equal(pub.s, 403); assert.equal(pub.j.codigo, 'confirmar_email');
  assert.equal((await app.call('POST', '/api/ajuda', { tok: n.tok, body: {} })).j.codigo, 'confirmar_email');

  app.db.prepare("UPDATE users SET email_status = 'confirmado' WHERE id = ?").run(l.id);
  assert.equal((await app.call('PUT', '/api/reviews', { tok: l.tok, body: { autor: a.slug, obra, nota: 5, texto: 'Li em uma noite so, recomendo.' } })).s, 200);
});

test('contas de antes da confirmacao (legado) seguem sem bloqueio; sem Resend configurado nada e bloqueado', async () => {
  caixaDeSaida();
  const app = makeApp(COM_EMAIL);
  const a = app.addUser({ nome: 'Ana' });
  const rp = await app.call('PUT', '/api/profile', { tok: a.tok, body: { data: { nome: 'Ana', links: [], secoes: [], obras: [{ titulo: 'O Rio', status: 'Publicado' }] } } });
  const obra = rp.j.data.obras[0].id;
  const antigo = app.addUser({ role: 'leitor', nome: 'Rui', email_status: 'legado' });
  assert.equal((await app.call('PUT', '/api/reviews', { tok: antigo.tok, body: { autor: a.slug, obra, nota: 4, texto: 'Bom livro, gostei bastante.' } })).s, 200);
  assert.equal((await app.call('GET', '/api/me', { tok: antigo.tok })).j.confirmar_email, false);

  const semEmail = makeApp();
  const r = await leitorNovo(semEmail);
  assert.equal(r.j.confirmar_email, false, 'sem RESEND_API_KEY nao ha como confirmar');
  assert.equal((await semEmail.call('GET', '/api/me', { tok: sessao(r) })).j.confirmar_email, false);
  assert.equal((await semEmail.call('POST', '/api/email/reenviar', { tok: sessao(r) })).s, 503);
});

test('migracao 0022: contas que ja existiam viram legado; conta nova nasce pendente', () => {
  const db = new DatabaseSync(':memory:');
  const dir = new URL('../../migrations/', import.meta.url);
  const arquivos = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  for (const f of arquivos.filter((f) => f < '0022')) db.exec(readFileSync(new URL(f, dir), 'utf8'));
  db.prepare("INSERT INTO users (email, pass_hash, pass_salt, slug, created_at) VALUES ('antiga@t.local', 'x', 'x', 'antiga', 1)").run();
  for (const f of arquivos.filter((f) => f >= '0022')) db.exec(readFileSync(new URL(f, dir), 'utf8'));
  assert.equal(db.prepare("SELECT email_status FROM users WHERE slug = 'antiga'").get().email_status, 'legado');
  db.prepare("INSERT INTO users (email, pass_hash, pass_salt, slug, created_at) VALUES ('nova@t.local', 'x', 'x', 'nova', 2)").run();
  assert.equal(db.prepare("SELECT email_status FROM users WHERE slug = 'nova'").get().email_status, 'pendente');
});
