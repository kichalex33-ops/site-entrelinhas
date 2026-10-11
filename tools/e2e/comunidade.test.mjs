import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { iniciar } from './helpers.mjs';

let E2E;
before(async () => { E2E = await iniciar(); });
after(async () => { await E2E.parar(); });

test('Comunidade: autor escreve uma resenha, filtra por tipo, edita e apaga; a pagina inicial mostra os recentes', async () => {
  const a = await E2E.novoAutor({ nome: 'Rita Resenha' });
  const p = a.pagina;
  p.on('dialog', (d) => d.accept()); // confirmar "Apagar"
  await p.goto(`${E2E.url}/index.html#comunidade`);
  await p.locator('#comEscrever').waitFor();
  assert.match(await p.innerText('#comLista'), /Ainda não há posts/);

  await p.click('#comEscrever');
  const dlg = p.locator('dialog.el-dialogo:has(h2:text("Escrever post"))');
  assert.ok(!(await dlg.locator('.com-fld-livro').isVisible()), 'noticia nao pede livro');
  await dlg.locator('select[name=tipo]').selectOption('resenha');
  assert.ok(await dlg.locator('.com-fld-livro').isVisible());
  await dlg.locator('input[name=titulo]').fill('Um livro sobre rios');
  await dlg.locator('textarea[name=texto]').fill('Primeiro parágrafo da resenha, com <b>tags</b> que não viram HTML.\n\nSegundo parágrafo.');
  await dlg.locator('[data-enviar]').click();
  await dlg.locator('.note.err:has-text("livro")').waitFor(); // resenha sem livro nao passa
  await dlg.locator('input[name=livro]').fill('O Rio, de Ana');
  await dlg.locator('[data-enviar]').click();
  await dlg.waitFor({ state: 'detached' });

  const card = p.locator('#comLista .com-post:has-text("Um livro sobre rios")');
  await card.waitFor();
  assert.match(await card.innerText(), /Resenha/); assert.match(await card.innerText(), /O Rio, de Ana/);
  assert.equal(await card.locator('.com-texto b').count(), 0, 'texto escapado');
  assert.equal(await card.locator('.com-texto p').count(), 2, 'paragrafos');
  assert.equal(await card.locator('.byline a').getAttribute('href'), `autor.html?a=${a.slug}`);

  await p.click('#comTipos .chip[data-tipo="dica"]');
  await p.locator('#comLista:has-text("Ainda não há posts deste tipo")').waitFor();
  await p.click('#comTipos .chip[data-tipo=""]');
  await card.waitFor();

  await card.locator('[data-editar]').click();
  const ed = p.locator('dialog.el-dialogo:has(h2:text("Editar post"))');
  await ed.locator('input[name=titulo]').fill('Um livro sobre rios (revisto)');
  await ed.locator('[data-enviar]').click();
  await p.locator('#comLista .com-post:has-text("(revisto)")').waitFor();

  await p.click('.tab[data-target="home"]');
  await p.locator('#news .com-post:has-text("(revisto)")').waitFor();
  assert.equal(await p.locator('#news .com-acao').count(), 0, 'pagina inicial sem botoes de acao');

  await p.click('.tab[data-target="comunidade"]');
  await p.locator('#comLista .com-post:has-text("(revisto)") [data-apagar]').click();
  await p.locator('#comLista:has-text("Ainda não há posts")').waitFor();
  assert.deepEqual(a.erros.filter((e) => !/status of 400/.test(e)), [], 'so o 400 provocado pela resenha sem livro');
});

test('Comunidade: leitor le, mas nao ve o botao de escrever', async () => {
  const mod = await E2E.novoAutor({ nome: 'Mod' });
  await E2E.app.call('POST', '/api/comunidade', { tok: mod.tok, body: { tipo: 'noticia', titulo: 'Bienal abre inscrições', texto: 'As inscrições para a mesa de autores independentes estão abertas.' } });
  const ctx = await E2E.navegador.newContext();
  const p = await ctx.newPage();
  await p.goto(`${E2E.url}/index.html#comunidade`);
  await p.locator('#comLista .com-post:has-text("Bienal abre")').waitFor();
  assert.ok(!(await p.isVisible('#comEscrever')));
  assert.ok(await p.isVisible('#comAviso'));
  assert.equal(await p.locator('.tab[data-target="comunidade"]').count(), 1);
  await ctx.close();
});

test('Editais e eventos: moderador aprova no painel e o item aparece na Comunidade; pendente e rejeitado nao', async () => {
  const mod = await E2E.novoAutor({ nome: 'Moderadora Editais' });
  E2E.app.db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(mod.id);
  E2E.app.db.prepare('UPDATE profiles SET data = ? WHERE slug = ?').run(JSON.stringify({ nome: 'Moderadora Editais', frase: '', local: '', bio: '', citacao: '', cor: '#d9a94a', fundo: 'preto', retrato: '', links: [], obras: [], secoes: [] }), mod.slug);
  const agora = Math.floor(Date.now() / 1000);
  const ins = (n, titulo) => E2E.app.db.prepare("INSERT INTO avisos (fonte, feed, titulo, link, publicado_em, coletado_em) VALUES ('Prefeitura de Teste', 'editais', ?, ?, ?, ?)").run(titulo, `https://exemplo.com/${n}`, agora - n, agora);
  ins(1, 'Edital Vozes da Bahia abre inscrições para autores'); ins(2, 'Concurso literário de contos com inscrição gratuita'); ins(3, 'Feira do Livro aceita autores independentes');

  const p = mod.pagina;
  await p.goto(`${E2E.url}/conta.html`);
  const sec = p.locator('#mod-avisos');
  await sec.locator('summary').click();
  await sec.locator('.mod-den').first().waitFor();
  assert.equal(await sec.locator('.mod-den').count(), 3);
  assert.equal(await sec.locator('.mod-badge').textContent(), '3');
  await sec.locator('.mod-den:has-text("Edital Vozes da Bahia") button:has-text("Aprovar")').click();
  await sec.locator('.mod-den:has-text("Concurso literário de contos") button:has-text("Rejeitar")').click();
  await sec.locator('.mod-badge').waitFor({ state: 'visible' });
  await p.waitForFunction(() => document.querySelectorAll('#mod-av-lista .mod-den').length === 1);

  const ctx = await E2E.navegador.newContext();
  const v = await ctx.newPage();
  await v.goto(`${E2E.url}/index.html#comunidade`);
  await v.locator('#comTipos .chip[data-tipo="avisos"]').click();
  const item = v.locator('#comLista .com-aviso-item');
  await item.first().waitFor();
  assert.equal(await item.count(), 1);
  assert.match(await item.textContent(), /Vozes da Bahia/); assert.match(await item.textContent(), /Prefeitura de Teste/);
  assert.equal(await item.locator('a').getAttribute('href'), 'https://exemplo.com/1');
  assert.equal(await item.locator('a').getAttribute('rel'), 'noopener noreferrer');
  assert.ok(await v.isVisible('#comNotaAvisos'));
  await v.click('#comTipos .chip[data-tipo=""]');
  await v.locator('#comNotaAvisos').waitFor({ state: 'hidden' }); // some quando a lista de posts termina de carregar
  await ctx.close();
  assert.deepEqual(mod.erros, []);
});
