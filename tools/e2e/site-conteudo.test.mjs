import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { iniciar } from './helpers.mjs';

let E2E;
before(async () => { E2E = await iniciar(); });
after(async () => { await E2E.parar(); });

const perfil = (nome) => JSON.stringify({ nome, frase: '', local: '', bio: '', citacao: '', cor: '#d9a94a', fundo: 'preto', retrato: '', links: [], obras: [], secoes: [] });

test('conteudo da pagina inicial: moderador muda um selo e um servico pela conta', async () => {
  const mod = await E2E.novoAutor({ nome: 'Moderadora' });
  E2E.app.db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(mod.id);
  E2E.app.db.prepare('UPDATE profiles SET data = ? WHERE slug = ?').run(perfil('Moderadora'), mod.slug);
  const p = mod.pagina;
  await p.goto(`${E2E.url}/conta.html`);
  await p.click('#mod-site summary');
  // noticias sairam do painel (viraram a aba Comunidade)
  assert.equal(await p.locator('.mod-site-sec:has(legend:text("Notícias"))').count(), 0);
  const selos = p.locator('.mod-site-sec:has(legend:text("Selos"))');
  await selos.locator('.mod-site-item').first().locator('label:has-text("Nome do selo") input').fill('Leitora beta');
  await selos.locator('button:has-text("Salvar selos")').click();
  await selos.locator('.note.ok').waitFor();

  // erro do servidor aparece no formulario
  const servicos = p.locator('.mod-site-sec:has(legend:text("Serviços"))');
  await servicos.locator('.mod-site-item').first().locator('label:has-text("Link") input').fill('javascript:alert(1)');
  await servicos.locator('button:has-text("Salvar serviços")').click();
  await servicos.locator('.note.err:has-text("Link")').waitFor();
  await servicos.locator('.mod-site-item').first().locator('label:has-text("Link") input').fill('ajuda.html');
  await servicos.locator('.mod-site-item').first().locator('select').selectOption('Pausado');
  await servicos.locator('button:has-text("Salvar serviços")').click();
  await servicos.locator('.note.ok').waitFor();

  await p.goto(`${E2E.url}/index.html`);
  await p.locator('#selos .selo:has-text("Leitora beta")').waitFor();
  assert.match(await p.locator('#services .service').first().innerText(), /Pausado/);
  assert.equal((await p.request.get(`${E2E.url}/data.json`)).status(), 404, 'o arquivo antigo saiu');
  assert.deepEqual(mod.erros.filter((e) => !/status of 400/.test(e)), [], 'so o 400 provocado pelo link invalido');
});
