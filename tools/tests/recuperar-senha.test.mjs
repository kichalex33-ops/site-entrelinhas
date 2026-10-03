import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp } from './helpers.mjs';

const tokenDe = (link) => new URL(link).searchParams.get('token');

test('moderador gera link, a pessoa troca a senha e entra; o link nao vale de novo', async () => {
  const app = makeApp();
  const mod = app.addUser({ mod: true, nome: 'Moderadora' });
  const autor = app.addUser({ nome: 'Autor' });

  const contas = await app.call('GET', '/api/admin/contas', { tok: mod.tok });
  assert.equal(contas.s, 200);
  assert.ok(contas.j.some((c) => c.email === `u${autor.id}@teste.local`));

  const r = await app.call('POST', '/api/admin/reset-link', { tok: mod.tok, body: { email: `u${autor.id}@teste.local` } });
  assert.equal(r.s, 200, JSON.stringify(r.j));
  assert.match(r.j.link, /^https:\/\/t\/redefinir\.html\?token=[a-f0-9]{64}$/, 'link no dominio de quem pediu');
  const token = tokenDe(r.j.link);

  assert.equal((await app.call('POST', '/api/redefinir', { body: { token, nova: 'curta' } })).s, 400);
  const ok = await app.call('POST', '/api/redefinir', { body: { token, nova: 'senha-nova-123' } });
  assert.equal(ok.s, 200, JSON.stringify(ok.j));

  // sessao antiga caiu; a senha nova entra
  assert.equal((await app.call('GET', '/api/me', { tok: autor.tok })).s, 401);
  assert.equal((await app.call('POST', '/api/login', { body: { email: `u${autor.id}@teste.local`, senha: 'senha-nova-123' } })).s, 200);

  // uso unico
  assert.equal((await app.call('POST', '/api/redefinir', { body: { token, nova: 'outra-senha-456' } })).s, 400);
});

test('gerar um link novo invalida o anterior; link expirado nao vale', async () => {
  const app = makeApp();
  const mod = app.addUser({ mod: true });
  const autor = app.addUser();
  const email = `u${autor.id}@teste.local`;
  const t1 = tokenDe((await app.call('POST', '/api/admin/reset-link', { tok: mod.tok, body: { email } })).j.link);
  const t2 = tokenDe((await app.call('POST', '/api/admin/reset-link', { tok: mod.tok, body: { email } })).j.link);
  assert.equal((await app.call('POST', '/api/redefinir', { body: { token: t1, nova: 'senha-nova-123' } })).s, 400);

  app.db.prepare('UPDATE password_resets SET expires_at = 1').run();
  assert.equal((await app.call('POST', '/api/redefinir', { body: { token: t2, nova: 'senha-nova-123' } })).s, 400);
});

test('so moderador gera link e ve a lista de contas', async () => {
  const app = makeApp();
  const autor = app.addUser();
  const outro = app.addUser();
  assert.equal((await app.call('GET', '/api/admin/contas', { tok: autor.tok })).s, 403);
  assert.equal((await app.call('GET', '/api/admin/contas')).s, 403);
  assert.equal((await app.call('POST', '/api/admin/reset-link', { tok: autor.tok, body: { email: `u${outro.id}@teste.local` } })).s, 403);
  assert.equal((await app.call('POST', '/api/admin/reset-link', { body: { email: `u${outro.id}@teste.local` } })).s, 401);
});

test('pedido publico responde igual exista a conta ou nao, e sem e-mail configurado nao cria link', async () => {
  const app = makeApp();
  const autor = app.addUser();
  const a = await app.call('POST', '/api/recuperar', { body: { email: `u${autor.id}@teste.local` } });
  const b = await app.call('POST', '/api/recuperar', { body: { email: 'ninguem@teste.local' } });
  assert.equal(a.s, 200); assert.equal(b.s, 200);
  assert.deepEqual(a.j, b.j);
  assert.equal(a.j.email, false);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM password_resets').get().n, 0);
});
