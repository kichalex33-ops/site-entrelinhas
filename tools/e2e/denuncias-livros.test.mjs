import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { iniciar } from './helpers.mjs';

let E2E;
before(async () => { E2E = await iniciar(); });
after(async () => { await E2E.parar(); });

const perfil = (nome, obras = []) => JSON.stringify({ nome, frase: '', local: '', bio: '', citacao: '', cor: '#d9a94a', fundo: 'preto', retrato: '', links: [], secoes: [], obras });

test('denunciar livro: leitor denuncia, autor ve o aviso, moderador decide no painel', async () => {
  const obraId = 'abcabc123123';
  const autora = await E2E.novoAutor({ nome: 'Autora' });
  E2E.app.db.prepare('UPDATE profiles SET data = ? WHERE slug = ?').run(perfil('Autora', [{ id: obraId, titulo: 'Livro Suspeito', genero: '', status: 'Publicado', sinopse: 's', capa: '', link: '', lojas: [], faixa: '12' }]), autora.slug);
  const url = `${E2E.url}/obra.html?a=${autora.slug}&o=${obraId}`;

  // visitante sem conta: e convidado a entrar
  const anon = await E2E.navegador.newContext();
  const pa = await anon.newPage();
  await pa.goto(url + '#denunciar');
  await pa.waitForSelector('dialog :text("entre na sua conta")');
  await anon.close();

  // leitor logado denuncia
  const leitor = E2E.app.addUser({ role: 'leitor', nome: 'Leitora' });
  const ctx = await E2E.navegador.newContext();
  await ctx.addCookies([{ name: 'sid', value: leitor.tok, url: E2E.url }]);
  const p = await ctx.newPage();
  const erros = [];
  p.on('pageerror', (e) => erros.push(e.message));
  await p.goto(url);
  await p.click('[data-denunciar]');
  const dlg = p.locator('dialog:has(h2:text("Denunciar este livro"))');
  await dlg.locator('input[value=plagio]').check();
  await dlg.locator('button:has-text("Enviar denúncia")').click();
  await dlg.locator('.note.err:has-text("Descreva")').waitFor();
  await dlg.locator('textarea[name=detalhe]').fill('O capítulo 2 é cópia de um conto publicado em 2019.');
  await dlg.locator('input[name=link]').fill('https://exemplo.com/conto');
  await dlg.locator('button:has-text("Enviar denúncia")').click();
  await p.waitForSelector('dialog :text("Denúncia enviada")');
  await ctx.close();

  // autora ve o aviso na pagina do proprio livro (sem o nome de quem denunciou)
  await autora.pagina.goto(url);
  await autora.pagina.waitForSelector('.livro-aviso');
  const aviso = await autora.pagina.innerText('.livro-aviso');
  assert.match(aviso, /Plágio/); assert.doesNotMatch(aviso, /Leitora/);
  assert.equal(await autora.pagina.locator('[data-denunciar]').isDisabled(), true);

  // moderador decide no painel
  const mod = await E2E.novoAutor({ nome: 'Moderadora' });
  E2E.app.db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(mod.id);
  E2E.app.db.prepare('UPDATE profiles SET data = ? WHERE slug = ?').run(perfil('Moderadora'), mod.slug);
  await mod.pagina.goto(`${E2E.url}/conta.html`);
  await mod.pagina.waitForSelector('#mod-denuncias .mod-badge:not([hidden])');
  await mod.pagina.click('#mod-denuncias summary');
  assert.match(await mod.pagina.innerText('#mod-den-lista'), /cópia de um conto/);
  assert.match(await mod.pagina.innerText('#mod-den-lista'), /Livro Suspeito/, 'o painel mostra o titulo do livro');
  await mod.pagina.fill('.mod-den-nota', 'Conversei com a autora; trecho reescrito.');
  await mod.pagina.click('.mod-den button[data-acao=resolver]');
  await mod.pagina.waitForSelector('#mod-den-lista :text("Nenhuma denúncia aberta")');
  await autora.pagina.reload();
  await autora.pagina.waitForSelector('.livro-titulo');
  assert.equal(await autora.pagina.locator('.livro-aviso').count(), 0, 'aviso some depois da decisao');
  assert.deepEqual(erros, []); assert.deepEqual(mod.erros, []); assert.deepEqual(autora.erros, []);
});

test('avaliacao denunciada: leitor denuncia, moderador oculta pelo painel; quem escreveu e o publico nao veem quem denunciou', async () => {
  const obraId = 'def123def123';
  const autora = await E2E.novoAutor({ nome: 'Autora Dois' });
  E2E.app.db.prepare('UPDATE profiles SET data = ? WHERE slug = ?').run(perfil('Autora Dois', [{ id: obraId, titulo: 'Livro Avaliado', genero: '', status: 'Publicado', sinopse: 's', capa: '', link: '', lojas: [], faixa: '12' }]), autora.slug);
  const url = `${E2E.url}/obra.html?a=${autora.slug}&o=${obraId}`;
  const rui = E2E.app.addUser({ role: 'leitor', nome: 'Rui Escritor' });
  await E2E.app.call('PUT', '/api/reviews', { tok: rui.tok, body: { autor: autora.slug, obra: obraId, nota: 1, texto: 'Texto ofensivo de teste para a moderacao.' } });

  // outra leitora denuncia pela pagina do livro
  const den = E2E.app.addUser({ role: 'leitor', nome: 'Denunciante Secreta' });
  const ctx = await E2E.navegador.newContext();
  await ctx.addCookies([{ name: 'sid', value: den.tok, url: E2E.url }]);
  const p = await ctx.newPage();
  await p.goto(url);
  await p.click('[data-aba=avaliacoes]');
  await p.click('.rev-item .rev-report summary');
  await p.click('.rev-item .rev-report button:has-text("Ofensivo")');
  await p.waitForTimeout(400);
  await ctx.close();

  // quem escreveu a avaliacao nao ve quem denunciou
  const ctxRui = await E2E.navegador.newContext();
  await ctxRui.addCookies([{ name: 'sid', value: rui.tok, url: E2E.url }]);
  const pr = await ctxRui.newPage();
  await pr.goto(url); await pr.click('[data-aba=avaliacoes]'); await pr.waitForSelector('.rev-item');
  assert.doesNotMatch(await pr.innerText('main'), /Denunciante Secreta/);
  await ctxRui.close();

  // moderador ve no painel e oculta
  const mod = await E2E.novoAutor({ nome: 'Moderador Dois' });
  E2E.app.db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(mod.id);
  E2E.app.db.prepare('UPDATE profiles SET data = ? WHERE slug = ?').run(perfil('Moderador Dois'), mod.slug);
  await mod.pagina.goto(`${E2E.url}/conta.html`);
  await mod.pagina.waitForSelector('#mod-den-av .mod-badge:not([hidden])');
  await mod.pagina.click('#mod-den-av summary');
  const painel = await mod.pagina.innerText('#mod-av-lista');
  assert.match(painel, /Livro Avaliado/); assert.match(painel, /Texto ofensivo/); assert.match(painel, /Denunciante Secreta/);
  await mod.pagina.click('#mod-av-lista button[data-acao=ocultar]');
  await mod.pagina.waitForSelector('#mod-av-lista :text("Nenhuma avaliação denunciada")');

  // saiu do ar para o publico
  const vis = await (await E2E.navegador.newContext()).newPage();
  await vis.goto(url); await vis.click('[data-aba=avaliacoes]');
  await vis.waitForTimeout(600);
  assert.equal(await vis.locator('.rev-item').count(), 0);
  assert.deepEqual(mod.erros, []);
});
