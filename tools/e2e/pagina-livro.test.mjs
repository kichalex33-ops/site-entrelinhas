import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { iniciar } from './helpers.mjs';

let E2E;
before(async () => { E2E = await iniciar({ ESTUDIO_PUBLICACAO: 'on' }); });
after(async () => { await E2E.parar(); });

const capa = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'public', 'autor', 'capa.jpg');

test('pagina do livro: o dono preenche personagens, galeria e materiais; o publico ve as abas', async () => {
  const a = await E2E.novoAutor({ nome: 'Autora Livro' });
  const obraId = 'abcdef123456';
  E2E.app.db.prepare('UPDATE profiles SET data = ? WHERE slug = ?').run(JSON.stringify({
    nome: 'Autora Livro', frase: '', local: '', bio: '', citacao: '', cor: '#d9a94a', fundo: 'preto', retrato: '', links: [], secoes: [],
    obras: [{ id: obraId, titulo: 'O Livro', genero: 'Fantasia', status: 'Publicado', sinopse: 'Uma sinopse.', capa: '', link: '', lojas: [], faixa: '12', publicado_em: '2024-05' }],
  }), a.slug);
  const url = `${E2E.url}/obra.html?a=${a.slug}&o=${obraId}`;
  const p = a.pagina;
  await p.goto(url);
  await p.waitForSelector('.livro-titulo');
  assert.match(await p.innerText('.livro-numeros'), /mai\.( de)? 2024\s+lançado em/i);
  assert.equal(await p.locator('[data-denunciar]').isDisabled(), true, 'o dono nao denuncia o proprio livro');
  await p.click('[data-editar]');
  const dlg = p.locator('dialog.el-dialogo:has(h2:text("Página do livro"))');
  await dlg.locator('textarea[name=contexto]').fill('Nasceu de um sonho.');
  await dlg.locator('input[name=tags]').fill('#Fantasia Sombria, rio');
  await dlg.locator('[data-add=lojas]').click();
  await dlg.locator('[data-k="lojas.0.rotulo"]').fill('Google Play');
  await dlg.locator('[data-k="lojas.0.url"]').fill('https://play.google.com/livro');
  await dlg.locator('[data-add=personagens]').click();
  await dlg.locator('[data-k="personagens.0.nome"]').fill('Kayla');
  await dlg.locator('[data-k="personagens.0.papel"]').fill('Protagonista');
  await dlg.locator('[data-upgaleria]').setInputFiles(capa);
  await dlg.locator('.ed-img img').waitFor();
  await dlg.locator('[data-k="imagens.0.legenda"]').fill('Mapa do rio');
  await dlg.locator('[data-add=materiais]').click();
  await dlg.locator('[data-k="materiais.0.rotulo"]').fill('Glossário');
  await dlg.locator('[data-k="materiais.0.url"]').fill('https://exemplo.com/glossario');
  await dlg.locator('button:has-text("Salvar")').click();
  await p.waitForSelector('.livro-abas button:has-text("Personagens (1)")');
  assert.match(await p.innerText('.livro-painel'), /Nasceu de um sonho\./);

  // Extras e Notas: o dono publica um spoiler com imagem
  await p.click('.livro-abas button:has-text("Extras e Notas")');
  await p.fill('.extra-novo textarea[name=texto]', 'O rio guarda um segredo.');
  await p.locator('[data-upextra]').setInputFiles(capa);
  await p.locator('.extra-novo-img img').waitFor();
  await p.check('.extra-novo input[name=spoiler]');
  await p.click('[data-publicar]');
  await p.waitForSelector('.livro-abas button:has-text("Extras e Notas (1)")');

  // publico: ve as abas, nao ve o botao de editar
  const ctx = await E2E.navegador.newContext();
  const v = await ctx.newPage();
  const erros = [];
  v.on('pageerror', (e) => erros.push(e.message));
  await v.goto(url);
  await v.waitForSelector('.livro-abas');
  assert.equal(await v.locator('[data-editar]').count(), 0);
  const abas = await v.locator('.livro-abas button').allInnerTexts();
  assert.deepEqual(abas, ['Sinopse', 'Personagens (1)', 'Galeria (1)', 'Materiais (1)', 'Avaliações', 'Extras e Notas (1)']);
  assert.deepEqual(await v.locator('.livro-tags span').allInnerTexts(), ['#fantasia-sombria', '#rio']);
  assert.equal(await v.locator('.livro-lojas a:has-text("Google Play")').count(), 1);
  assert.equal(await v.locator('[data-denunciar]').isDisabled(), false);
  await v.click('[data-favoritar]');
  await v.waitForSelector('dialog :text("Entre na sua conta para guardar")');
  await v.click('dialog button:has-text("Fechar")');
  await v.click('.livro-abas button:has-text("Extras e Notas")');
  await v.waitForSelector('.extra-corpo.spoiler');
  await v.click('[data-revelar]');
  assert.equal(await v.locator('.extra-corpo.spoiler').count(), 0);
  assert.match(await v.innerText('.extra-corpo'), /O rio guarda um segredo\./);
  await v.click('.livro-abas button:has-text("Personagens")');
  assert.match(await v.innerText('.livro-pers'), /Kayla\s+Protagonista/);
  await v.click('.livro-abas button:has-text("Galeria")');
  await v.click('.livro-galeria button');
  await v.waitForSelector('dialog .livro-zoom');
  await v.click('dialog button:has-text("Fechar")');
  await v.goto(url + '#materiais');
  await v.waitForSelector('.livro-mat a:has-text("Glossário")');
  await v.click('.livro-abas button:has-text("Avaliações")');
  await v.waitForSelector('.livro-rev *');
  assert.deepEqual(erros, []);
  assert.deepEqual(a.erros, []);
  await ctx.close();
});
