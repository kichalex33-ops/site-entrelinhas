import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp } from './helpers.mjs';

// limitador falso com a mesma interface do Rate Limiting do Cloudflare
function limitador(max) {
  const contas = new Map();
  return { chaves: contas, limit: async ({ key }) => { const n = (contas.get(key) || 0) + 1; contas.set(key, n); return { success: n <= max }; } };
}

test('limite geral de escritas: por sessao, vale para qualquer rota de escrita, leitura nao conta', async () => {
  const ESCRITAS = limitador(3);
  const app = makeApp({ ESCRITAS });
  const a = app.addUser({ role: 'leitor', nome: 'Lia' });
  const b = app.addUser({ role: 'leitor', nome: 'Bia' });
  for (let i = 0; i < 3; i++) assert.equal((await app.call('POST', '/api/estantes', { tok: a.tok, body: { nome: 'Lista ' + i } })).s, 200);
  const bloqueada = await app.call('POST', '/api/estantes', { tok: a.tok, body: { nome: 'Lista 4' } });
  assert.equal(bloqueada.s, 429);
  assert.match(bloqueada.j.erro, /Muitas ações/);
  assert.equal((await app.call('PUT', '/api/leitor', { tok: a.tok, body: { nome: 'Lia' } })).s, 429, 'outra rota de escrita tambem para');
  assert.equal((await app.call('GET', '/api/estantes', { tok: a.tok })).s, 200, 'leitura continua');
  assert.equal((await app.call('POST', '/api/estantes', { tok: b.tok, body: { nome: 'Minha' } })).s, 200, 'outra pessoa nao e afetada');
  assert.ok([...ESCRITAS.chaves.keys()].every((k) => !k.includes(a.tok)), 'o token da sessao nao vai para o limitador');
});

test('limite geral de escritas: sem login conta por IP; sem a ligacao nao limita', async () => {
  const app = makeApp({ ESCRITAS: limitador(1) });
  assert.notEqual((await app.call('POST', '/api/login', { body: { email: 'x@y.com', senha: 'z' }, ip: '9.9.9.9' })).s, 429);
  assert.equal((await app.call('POST', '/api/login', { body: { email: 'x@y.com', senha: 'z' }, ip: '9.9.9.9' })).s, 429);
  assert.notEqual((await app.call('POST', '/api/login', { body: { email: 'x@y.com', senha: 'z' }, ip: '8.8.8.8' })).s, 429);

  const livre = makeApp();
  const u = livre.addUser({ role: 'leitor' });
  for (let i = 0; i < 5; i++) assert.equal((await livre.call('POST', '/api/estantes', { tok: u.tok, body: { nome: 'L' + i } })).s, 200);
});
