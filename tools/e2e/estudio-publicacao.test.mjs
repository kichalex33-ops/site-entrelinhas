import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { iniciar } from './helpers.mjs';

let E2E;
before(async () => { E2E = await iniciar({ ESTUDIO_PUBLICACAO: 'on', DISQUS_SHORTNAME: 'entrelinhas-teste' }); });
after(async () => { await E2E.parar(); });

const salvo = (p) => p.waitForFunction(() => document.querySelector('.st-estado')?.dataset.estado === 'salvo', null, { timeout: 15000 });

test('publicar: escrever, publicar pelo botao, ler em ler.html, aparecer no perfil e na biblioteca', async () => {
  const a = await E2E.novoAutor({ nome: 'Autora Publicada' });
  const p = a.pagina;
  await p.goto(`${E2E.url}/estudio.html`);
  await p.click('#st-nova');
  await p.click('.st-opcao:has-text("Escrever no Entrelinhas")');
  await p.fill('dialog input', 'O Rio');
  await p.click('dialog button:has-text("Criar obra")');
  await p.waitForSelector('.st-explorador .st-nome');
  assert.doesNotMatch(await p.innerText('.st-explorador'), /null/, 'obra sem tags nao mostra "null"');
  assert.doesNotMatch(await p.innerText('.st-contexto'), /null/, 'contexto sem documento nao mostra "null"');

  for (const texto of ['Kayla olhou o rio. #segredo', 'A água lembrava de [[Márcia]].']) {
    await p.hover('.st-linha:has-text("Manuscrito")');
    await p.click('button[aria-label="Novo documento em Manuscrito"]');
    await p.waitForSelector('.st-pm .ProseMirror');
    await p.click('.st-pm .ProseMirror');
    await p.keyboard.type(texto, { delay: 5 });
  }
  await salvo(p);

  // botao Publicar na barra da obra
  await p.click('.st-bar-btn:has-text("Publicar")');
  const dlg = p.locator('dialog.st-pub');
  await dlg.waitFor();
  assert.equal(await dlg.locator('.st-pub-caps input:checked').count(), 2, 'os capitulos do manuscrito vem marcados');
  const ok = dlg.locator('.st-dialogo-rodape .btn-primary');
  assert.ok(await ok.isDisabled(), 'sem aceitar a declaracao, nao publica');
  await dlg.locator('textarea').fill('Um rio que lembra de tudo.');
  await dlg.locator('.st-pub-aceite input').check();
  await ok.click();
  await dlg.locator('.st-exp-estado:has-text("faixa etária")').waitFor(); // sem faixa nao publica
  await dlg.locator('input[name=st-pub-faixa][value="12"]').check();
  await dlg.locator('.st-pub-aceite input').check();
  await ok.click();
  const link = p.locator('dialog a:has-text("Abrir a página de leitura")');
  await link.waitFor();
  const href = await link.getAttribute('href');

  // leitura publica, sem login
  const ctx = await E2E.navegador.newContext();
  const leitor = await ctx.newPage();
  const erros = [];
  leitor.on('pageerror', (e) => erros.push(e.message));
  await leitor.goto(`${E2E.url}/${href}`);
  await leitor.waitForSelector('.ler-sumario li');
  assert.match(await leitor.locator('.ler-obra h2').innerText(), /^O Rio/);
  assert.equal(await leitor.locator('.ler-sumario li').count(), 2);
  assert.equal(await leitor.locator('.ler-obra .faixa').innerText(), '12', 'selo da faixa etaria na pagina da obra');
  await leitor.click('a:has-text("Começar a ler")');
  await leitor.waitForSelector('.ler-texto p');
  assert.equal(await leitor.locator('.ler-texto p').innerText(), 'Kayla olhou o rio.', '#tag some do texto publico');
  await leitor.click('a:has-text("Próximo")');
  await leitor.waitForSelector('.ler-texto p:has-text("Márcia")');
  assert.equal(await leitor.locator('.ler-texto p').innerText(), 'A água lembrava de Márcia.', '[[link]] vira texto');

  // comentarios (Disqus): nada carrega ate o leitor pedir; o clique carrega o embed do shortname configurado
  const disqus = [];
  await leitor.route('https://*.disqus.com/**', (r) => { disqus.push(r.request().url()); r.abort(); });
  await leitor.waitForSelector('.ler-comentarios:not([hidden]) #ver-comentarios');
  assert.equal(disqus.length, 0, 'Disqus nao carrega sozinho');
  await leitor.click('#ver-comentarios');
  await leitor.waitForFunction(() => document.querySelector('script[src="https://entrelinhas-teste.disqus.com/embed.js"]'));
  const id = await leitor.evaluate(() => { const o = { page: {} }; window.disqus_config.call(o); return o.page.identifier; });
  assert.match(id, /^[a-f0-9]{12}-[a-f0-9]{12}$/, 'conversa presa ao documento, nao ao numero do capitulo');

  // perfil do autor e biblioteca mostram a obra (perfil completo, como o salvo pela conta)
  E2E.app.db.prepare('UPDATE profiles SET data = ? WHERE slug = ?').run(JSON.stringify({ nome: 'Autora Publicada', frase: '', local: '', bio: '', citacao: '', cor: '#d9a94a', fundo: 'preto', retrato: '', links: [], obras: [], secoes: [] }), a.slug);
  await leitor.goto(`${E2E.url}/autor.html?a=${a.slug}`);
  await leitor.waitForSelector('a:has-text("Ler no Entrelinhas")');
  await leitor.goto(`${E2E.url}/index.html`);
  await leitor.waitForSelector('#recentes .rel-card:has-text("O Rio")'); // carrossel Recem-publicadas
  await leitor.goto(`${E2E.url}/index.html#biblioteca`);
  await leitor.waitForSelector('#libraryGrid .book-card:has-text("O Rio") .tag-ler');
  await leitor.click('#libraryGrid .book-card:has-text("O Rio")');
  await leitor.waitForURL(/obra\.html\?a=/);
  await leitor.waitForSelector('.livro-titulo:has-text("O Rio")');
  assert.deepEqual(erros, []);
  await ctx.close();
  assert.deepEqual(a.erros, []);
});
