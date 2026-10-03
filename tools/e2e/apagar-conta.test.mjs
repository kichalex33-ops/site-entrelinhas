import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { iniciar } from './helpers.mjs';

let E2E;
before(async () => { E2E = await iniciar(); });
after(async () => { await E2E.parar(); });

test('apagar conta: o autor confirma com senha e APAGAR, e a pagina publica some', async () => {
  const a = await E2E.novoAutor({ nome: 'Ana Some' });
  E2E.app.db.prepare('UPDATE profiles SET data = ? WHERE slug = ?').run(JSON.stringify({ nome: 'Ana Some', frase: '', local: '', bio: '', citacao: '', cor: '#d9a94a', fundo: 'preto', retrato: '', links: [], secoes: [], obras: [] }), a.slug);
  // senha de verdade pelo link de redefinicao; o cookie do teste continua valendo ate o login
  const mod = E2E.app.addUser({ mod: true });
  const link = (await E2E.app.call('POST', '/api/admin/reset-link', { tok: mod.tok, body: { email: `u${a.id}@teste.local` } })).j.link;
  await E2E.app.call('POST', '/api/redefinir', { body: { token: new URL(link).searchParams.get('token'), nova: 'senha-secreta-123' } });
  await a.pagina.goto(`${E2E.url}/conta.html`);
  await a.pagina.fill('input[type=email]', `u${a.id}@teste.local`);
  await a.pagina.fill('input[type=password]', 'senha-secreta-123');
  await a.pagina.click('button[type=submit]');

  await a.pagina.click('.apagar-conta summary');
  await a.pagina.fill('#apagarForm [name=senha]', 'senha-secreta-123');
  await a.pagina.fill('#apagarForm [name=confirmar]', 'APAGAR');
  await a.pagina.click('#apagarForm button[type=submit]');
  await a.pagina.waitForSelector(':text("Sua conta foi apagada")');

  assert.equal((await E2E.app.call('GET', `/api/profile/${a.slug}`)).s, 404);
  // o 401 e o /api/me da tela de login antes de entrar (a redefinicao de senha derruba a sessao)
  assert.deepEqual(a.erros.filter((e) => !/status of 401/.test(e)), []);
});
