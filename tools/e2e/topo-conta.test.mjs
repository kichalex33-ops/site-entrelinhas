import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { iniciar } from './helpers.mjs';

let E2E;
before(async () => { E2E = await iniciar(); });
after(async () => { await E2E.parar(); });

test('topo: visitante ve "Entrar"; leitor ve a foto com menu; Sair desloga', async () => {
  const anon = await (await E2E.navegador.newContext()).newPage();
  await anon.goto(`${E2E.url}/autores.html`);
  await anon.click('.topo-acoes a.topo-entrar');
  await anon.waitForURL(/conta\.html$/);
  assert.equal(await anon.locator('.topo-entrar').count(), 0, 'na propria tela de login o botao some');

  const l = E2E.app.addUser({ role: 'leitor', nome: 'Lia' });
  E2E.app.db.prepare('INSERT INTO images (id, user_id, mime, data, created_at) VALUES (?, ?, ?, ?, ?)').run('fe'.repeat(12), l.id, 'image/png', new Uint8Array([1]), 1);
  E2E.app.db.prepare('UPDATE users SET foto = ? WHERE id = ?').run('fe'.repeat(12), l.id);
  const ctx = await E2E.navegador.newContext();
  await ctx.addCookies([{ name: 'sid', value: l.tok, url: E2E.url }]);
  const p = await ctx.newPage();
  await p.goto(`${E2E.url}/index.html`);
  await p.waitForSelector(`.topo-foto img[src="/img/${'fe'.repeat(12)}?v=2"]`);
  assert.equal(await p.locator('.topo-entrar').count(), 0);
  await p.click('.topo-foto');
  assert.deepEqual(await p.locator('.topo-menu a').allInnerTexts(), ['Meu perfil', 'Minha conta']);
  assert.equal(await p.getAttribute('.topo-menu a:has-text("Meu perfil")', 'href'), `leitor.html?u=${l.slug}`);
  await p.click('body', { position: { x: 5, y: 600 } });
  assert.equal(await p.locator('.topo-menu').isHidden(), true, 'clicar fora fecha');
  await p.click('.topo-foto');
  await p.click('.topo-menu [data-sair]');
  await p.waitForURL(/index\.html$/);
  await p.waitForSelector('.topo-entrar');

  // autor: menu leva ao perfil de autor e ao Estudio
  const a = await E2E.novoAutor({ nome: 'Ana' });
  await a.pagina.goto(`${E2E.url}/index.html`);
  await a.pagina.click('.topo-foto');
  assert.deepEqual(await a.pagina.locator('.topo-menu a').allInnerTexts(), ['Meu perfil', 'Minha conta', 'Estúdio de escrita', 'Lixeira de livros']);
  assert.equal(await a.pagina.getAttribute('.topo-menu a:has-text("Meu perfil")', 'href'), `autor.html?a=${a.slug}`);
});
