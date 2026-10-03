import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { iniciar } from './helpers.mjs';

let E2E;
before(async () => { E2E = await iniciar(); });
after(async () => { await E2E.parar(); });

const perfil = (nome) => JSON.stringify({ nome, frase: '', local: '', bio: '', citacao: '', cor: '#d9a94a', fundo: 'preto', retrato: '', links: [], obras: [], secoes: [] });

test('adicionar obra: escolher caminho, divulgar livro de fora pela janela, editar e remover', async () => {
  const a = await E2E.novoAutor({ nome: 'Autora Divulga' });
  E2E.app.db.prepare('UPDATE profiles SET data = ? WHERE slug = ?').run(perfil('Autora Divulga'), a.slug);
  const p = a.pagina;
  await p.goto(`${E2E.url}/conta.html`);
  await p.click('button[data-novaobra]');
  const escolha = p.locator('dialog.el-dialogo');
  assert.equal(await escolha.locator('.el-opcao').count(), 3);
  await escolha.locator('.el-opcao:has-text("Divulgar livro de fora")').click();

  const dlg = p.locator('dialog.el-dialogo:has(h2:text("Divulgar livro"))');
  await dlg.locator('input[name=titulo]').fill('Livro de Fora');
  await dlg.locator('input[name=genero]').fill('Romance');
  await dlg.locator('textarea[name=sinopse]').fill('Uma história vendida em outro lugar.');
  await dlg.locator('input[name=faixa][value="14"]').check();
  await dlg.locator('input[name=ano]').fill('2024');
  await dlg.locator('select[name=mes]').selectOption('03');
  await dlg.locator('input[name=link]').fill('https://exemplo.com/livro');
  await dlg.locator('[data-loja]').click();
  await dlg.locator('[data-lr="0"]').fill('Amazon');
  await dlg.locator('[data-lu="0"]').fill('https://amazon.com/livro');
  await dlg.locator('button:has-text("Adicionar ao perfil")').click();
  await p.waitForSelector('.obra-item:has-text("Livro de Fora")');
  let salvo = JSON.parse(E2E.app.db.prepare('SELECT data FROM profiles WHERE slug = ?').get(a.slug).data);
  assert.equal(salvo.obras.length, 1);
  assert.equal(salvo.obras[0].lojas[0].rotulo, 'Amazon');
  assert.equal(salvo.obras[0].faixa, '14'); assert.equal(salvo.obras[0].publicado_em, '2024-03'); assert.ok(salvo.obras[0].no_site_em);

  // editar pela mesma janela
  await p.click('.obra-item button[data-editobra="0"]');
  const ed = p.locator('dialog.el-dialogo:has(h2:text("Editar livro"))');
  assert.equal(await ed.locator('input[name=titulo]').inputValue(), 'Livro de Fora');
  await ed.locator('input[name=titulo]').fill('Livro de Fora (2ª ed.)');
  await ed.locator('button:has-text("Salvar")').click();
  await p.waitForSelector('.obra-item:has-text("2ª ed.")');

  // atalho da pagina publica abre a janela de edicao
  salvo = JSON.parse(E2E.app.db.prepare('SELECT data FROM profiles WHERE slug = ?').get(a.slug).data);
  await p.goto(`${E2E.url}/autor.html?a=${a.slug}`); // vem da pagina publica (carregamento completo)
  await p.goto(`${E2E.url}/conta.html#obra-${salvo.obras[0].id}`);
  await p.waitForSelector('dialog.el-dialogo:has(h2:text("Editar livro"))');
  await p.click('dialog.el-dialogo button:has-text("Cancelar")');

  // remover
  await p.click('.obra-item button[data-rmobra="0"]');
  await p.click('dialog.el-dialogo button:has-text("Remover")');
  await p.waitForSelector('text=Nenhum livro divulgado ainda.');
  assert.equal(JSON.parse(E2E.app.db.prepare('SELECT data FROM profiles WHERE slug = ?').get(a.slug).data).obras.length, 0);

  // "escrever aqui no site" leva ao Estudio ja pedindo o titulo da obra nova
  await p.click('button[data-novaobra]');
  await p.click('.el-opcao:has-text("Escrever aqui no site")');
  await p.waitForSelector('dialog :text("Como se chama a obra?")');
  await p.fill('dialog input', 'Obra Nova');
  await p.click('dialog button:has-text("Criar obra")');
  await p.waitForSelector('.st-explorador .st-nome');
  assert.deepEqual(a.erros, []);
});
