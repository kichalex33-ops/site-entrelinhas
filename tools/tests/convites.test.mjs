import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp } from './helpers.mjs';

const cadastrar = (app, convite, email = 'nova@teste.local') => app.call('POST', '/api/register', { body: { convite, email, senha: 'senha-segura-123', nome: 'Nova Autora' } });

test('moderador gera convite; autor se cadastra com ele; o convite nao serve de novo', async () => {
  const app = makeApp();
  const mod = app.addUser({ mod: true, nome: 'Moderadora' });
  const r = await app.call('POST', '/api/admin/convites', { tok: mod.tok, body: { para: 'Maria' } });
  assert.equal(r.s, 200, JSON.stringify(r.j));
  assert.match(r.j.codigo, /^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/);
  assert.equal(r.j.link, `https://t/conta.html#convite=${r.j.codigo}`);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM invites WHERE code_hash = ?').get(r.j.codigo)?.n ?? 0, 0, 'o codigo em claro nao vai para o banco');

  let lista = (await app.call('GET', '/api/admin/convites', { tok: mod.tok })).j;
  assert.equal(lista[0].para, 'Maria'); assert.equal(lista[0].situacao, 'aberto');

  const c = await cadastrar(app, r.j.codigo.toLowerCase());
  assert.equal(c.s, 200, JSON.stringify(c.j));
  assert.equal(c.j.slug, 'nova-autora');
  lista = (await app.call('GET', '/api/admin/convites', { tok: mod.tok })).j;
  assert.equal(lista[0].situacao, 'usado'); assert.equal(lista[0].usado_por, 'nova-autora');

  assert.equal((await cadastrar(app, r.j.codigo, 'outra@teste.local')).s, 403);
});

test('convite expirado nao abre cadastro; so moderador gera e lista', async () => {
  const app = makeApp();
  const mod = app.addUser({ mod: true });
  const autor = app.addUser();
  const r = await app.call('POST', '/api/admin/convites', { tok: mod.tok, body: {} });
  app.db.prepare('UPDATE invites SET expires_at = 1').run();
  const c = await cadastrar(app, r.j.codigo);
  assert.equal(c.s, 403); assert.match(c.j.erro, /expirou/);

  assert.equal((await app.call('POST', '/api/admin/convites', { tok: autor.tok, body: {} })).s, 403);
  assert.equal((await app.call('GET', '/api/admin/convites', { tok: autor.tok })).s, 403);
  assert.equal((await app.call('POST', '/api/admin/convites', { body: {} })).s, 401);
});
