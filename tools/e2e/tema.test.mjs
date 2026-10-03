import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { iniciar } from './helpers.mjs';

let E2E;
before(async () => { E2E = await iniciar(); });
after(async () => { await E2E.parar(); });

test('tema: escuro por padrao; o botao alterna para claro e a escolha vale nas outras paginas', async () => {
  const a = await E2E.novoAutor({ nome: 'Ana Tema' });
  E2E.app.db.prepare('UPDATE profiles SET data = ? WHERE slug = ?').run(JSON.stringify({ nome: 'Ana Tema', frase: '', local: '', bio: '', citacao: '', cor: '#3366cc', fundo: 'vinho', retrato: '', links: [], secoes: [], obras: [] }), a.slug);
  const p = a.pagina;
  const fundo = () => p.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await p.goto(`${E2E.url}/index.html`);
  assert.equal(await p.getAttribute('html', 'data-tema'), 'escuro');
  assert.equal(await fundo(), 'rgb(0, 0, 0)');

  await p.click('.tema-bt');
  assert.equal(await p.getAttribute('html', 'data-tema'), 'claro');
  assert.equal(await fundo(), 'rgb(246, 242, 234)');
  assert.equal(await p.getAttribute('meta[name="theme-color"]', 'content'), '#f6f2ea');

  // vale ao abrir outra pagina; a cor do autor fica mais escura no claro (continua legivel)
  await p.goto(`${E2E.url}/autor.html?a=${a.slug}`);
  await p.waitForSelector('.tinta-autor');
  assert.equal(await p.getAttribute('html', 'data-tema'), 'claro');
  const corClaro = await p.evaluate(() => getComputedStyle(document.querySelector('.tinta-autor')).getPropertyValue('--accent').trim());
  await p.click('.tema-bt');
  const corEscuro = await p.evaluate(() => getComputedStyle(document.querySelector('.tinta-autor')).getPropertyValue('--accent').trim());
  assert.notEqual(corClaro, corEscuro);
  assert.equal(await p.evaluate(() => getComputedStyle(document.querySelector('.tinta-autor')).backgroundImage.includes('58, 19, 34')), true, 'fundo vinho no escuro');
  assert.deepEqual(a.erros, []);
});
