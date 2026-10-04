import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { iniciar } from './helpers.mjs';

let E2E;
before(async () => { E2E = await iniciar(); });
after(async () => { await E2E.parar(); });

const perfil = (nome) => JSON.stringify({ nome, frase: '', local: '', bio: '', citacao: '', cor: '#d9a94a', fundo: 'preto', retrato: '', links: [], obras: [], secoes: [] });

test('conteudo da pagina inicial: moderador publica uma noticia e muda um servico pela conta', async () => {
  const mod = await E2E.novoAutor({ nome: 'Moderadora' });
  E2E.app.db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(mod.id);
  E2E.app.db.prepare('UPDATE profiles SET data = ? WHERE slug = ?').run(perfil('Moderadora'), mod.slug);
  const p = mod.pagina;
  await p.goto(`${E2E.url}/conta.html`);
  await p.click('#mod-site summary');
  const noticias = p.locator('.mod-site-sec:has(legend:text("Notícias"))');
  await noticias.locator('button:has-text("Adicionar notícia")').click();
  const nova = noticias.locator('.mod-site-item').last();
  await nova.locator('label:has-text("Data") input').fill('04/10/2026');
  await nova.locator('label:has-text("Título") input').fill('Busca nova na Biblioteca');
  await nova.locator('label:has-text("Texto") textarea').fill('Agora dá para procurar livros por título, autor e gênero.');
  await nova.locator('label:has-text("Assinado por") input').fill('Moderadora');
  await nova.locator('label:has-text("Endereço do perfil") input').fill(mod.slug);
  // a nova sobe para o topo da lista
  for (let i = 0; i < 10 && !(await noticias.locator('.mod-site-item').first().locator('input').nth(1).inputValue()).startsWith('Busca'); i++) await noticias.locator('.mod-site-item').last().locator('button[title=Subir]').click().catch(() => {});
  await noticias.locator('button:has-text("Salvar notícias")').click();
  await noticias.locator('.note.ok').waitFor();

  // erro do servidor aparece no formulario
  const servicos = p.locator('.mod-site-sec:has(legend:text("Serviços"))');
  await servicos.locator('.mod-site-item').first().locator('label:has-text("Link") input').fill('javascript:alert(1)');
  await servicos.locator('button:has-text("Salvar serviços")').click();
  await servicos.locator('.note.err:has-text("Link")').waitFor();
  await servicos.locator('.mod-site-item').first().locator('label:has-text("Link") input').fill('ajuda.html');
  await servicos.locator('.mod-site-item').first().locator('select').selectOption('Pausado');
  await servicos.locator('button:has-text("Salvar serviços")').click();
  await servicos.locator('.note.ok').waitFor();

  await p.goto(`${E2E.url}/index.html#comunidade`);
  await p.waitForSelector('#news .post');
  const n = p.locator('#news .post:has-text("Busca nova na Biblioteca")');
  assert.equal(await n.locator('.byline a').getAttribute('href'), `autor.html?a=${mod.slug}`);
  assert.match(await p.locator('#services .service').first().innerText(), /Pausado/);
  assert.equal((await p.request.get(`${E2E.url}/data.json`)).status(), 404, 'o arquivo antigo saiu');
  assert.deepEqual(mod.erros.filter((e) => !/status of 400/.test(e)), [], 'so o 400 provocado pelo link invalido');
});
