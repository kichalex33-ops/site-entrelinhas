// Jornada completa do autor, pela interface: convite -> criar conta -> confirmar e-mail -> editar perfil -> Estudio
// (obra e capitulo) -> publicar (bloqueado antes de confirmar) -> perfil, Biblioteca e leitura publica ->
// atualizar a publicacao -> tirar do ar -> publicar de novo. Importar e exportar tem testes proprios
// (estudio-importar-exportar.test.mjs). O Resend e simulado neste processo: nada sai para a internet.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { iniciar } from './helpers.mjs';

let E2E;
const caixa = [];
const fetchOriginal = globalThis.fetch;
before(async () => {
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith('https://api.resend.com/')) { caixa.push(JSON.parse(init.body)); return new Response('{}', { status: 200 }); }
    return fetchOriginal(url, init);
  };
  E2E = await iniciar({ ESTUDIO_PUBLICACAO: 'on', RESEND_API_KEY: 're_e2e' });
});
after(async () => { await E2E.parar(); globalThis.fetch = fetchOriginal; });

// abre a obra publicada (sumario) e entra no primeiro capitulo
async function ler(vis, url) {
  await vis.goto(url);
  await vis.waitForSelector('.ler-sumario li');
  await vis.click('a:has-text("Começar a ler")');
  await vis.waitForSelector('.ler-texto p');
}
const salvo = (p) => p.waitForFunction(() => document.querySelector('.st-estado')?.dataset.estado === 'salvo', null, { timeout: 15000 });

async function publicarPeloEstudio(p, { sinopse, faixa = '12', aceitar = true } = {}) {
  await p.click('.st-bar-btn:has-text("Publicar")');
  const dlg = p.locator('dialog.st-pub');
  await dlg.waitFor();
  if (sinopse) await dlg.locator('textarea').fill(sinopse);
  if (faixa) await dlg.locator(`input[name=st-pub-faixa][value="${faixa}"]`).check();
  if (aceitar) await dlg.locator('.st-pub-aceite input').check();
  await dlg.locator('.st-dialogo-rodape .btn-primary').click();
  return dlg;
}

test('jornada do autor: convite, confirmacao, perfil, escrever, publicar, atualizar, tirar do ar e publicar de novo', async () => {
  const { app } = E2E;
  const mod = app.addUser({ mod: true, nome: 'Moderadora' });
  const codigo = (await app.call('POST', '/api/admin/convites', { tok: mod.tok, body: { para: 'Rui' } })).j.codigo;
  const U = E2E.url;
  const ctx = await E2E.navegador.newContext({ viewport: { width: 1400, height: 900 }, locale: 'pt-BR' });
  const p = await ctx.newPage();
  const erros = [];
  p.on('pageerror', (e) => erros.push(e.message));

  // 1. criar a conta pelo link do convite
  await p.goto(`${U}/conta.html#convite=${codigo}`);
  await p.waitForSelector('#authForm input[name=convite]');
  await p.fill('#authForm input[name=nome]', 'Rui Contista');
  await p.fill('#authForm input[name=email]', 'rui@teste.local');
  await p.fill('#authForm input[name=senha]', 'senha-segura-123');
  await p.check('#authForm input[name=aceite]');
  await p.click('#authForm button[type=submit]');
  await p.waitForSelector('#ed');
  await p.waitForSelector('.aviso-email');
  await p.waitForSelector('.primeiros-passos:has-text("0 de 5")');
  const slug = app.db.prepare("SELECT slug FROM users WHERE email = 'rui@teste.local'").get().slug;

  // 2. editar o perfil
  await p.fill('#ed input[data-k=frase]', 'Contos curtos sobre cidades pequenas.');
  await p.click('#saveBtn');
  await p.waitForSelector('#saveNote:has-text("Salvo")');

  // 3. Estudio: obra e capitulo
  await p.goto(`${U}/estudio.html`);
  await p.click('#st-nova');
  await p.click('.st-opcao:has-text("Escrever no Entrelinhas")');
  await p.fill('dialog input', 'Cidade Pequena');
  await p.click('dialog button:has-text("Criar obra")');
  await p.waitForSelector('.st-explorador .st-nome');
  await p.hover('.st-linha:has-text("Manuscrito")');
  await p.click('button[aria-label="Novo documento em Manuscrito"]');
  await p.waitForSelector('.st-pm .ProseMirror');
  await p.click('.st-pm .ProseMirror');
  await p.keyboard.type('Na cidade pequena todo mundo sabia de tudo.', { delay: 5 });
  await salvo(p);

  // 4. sem confirmar o e-mail, publicar e recusado com explicacao
  let dlg = await publicarPeloEstudio(p, { sinopse: 'Uma cidade onde ninguem guarda segredo.' });
  await dlg.locator('.st-exp-estado:has-text("Confirme seu e-mail")').waitFor();
  await dlg.locator('button:has-text("Fechar")').click();

  // 5. confirmar pelo link do e-mail (em outra aba)
  const link = caixa.find((m) => m.to === 'rui@teste.local' && /Confirme/.test(m.subject)).text.match(/https?:\/\/\S+token=[a-f0-9]{64}/)[0];
  const aba = await ctx.newPage();
  await aba.goto(link);
  await aba.waitForSelector('.note.ok');
  await aba.close();

  // 6. publicar (declaracao definitiva aceita)
  dlg = await publicarPeloEstudio(p, { sinopse: 'Uma cidade onde ninguem guarda segredo.' });
  const abrir = p.locator('dialog a:has-text("Abrir a página de leitura")');
  await abrir.waitFor();
  const href = await abrir.getAttribute('href');
  assert.equal(app.db.prepare('SELECT declaration_version FROM studio_acceptances ORDER BY id DESC LIMIT 1').get().declaration_version, 2);
  await p.keyboard.press('Escape');

  // 7. leitura publica, perfil e Biblioteca, como visitante
  const vis = await (await E2E.navegador.newContext()).newPage();
  await ler(vis, `${U}/${href}`);
  await vis.waitForSelector('.ler-texto p:has-text("todo mundo sabia de tudo")');
  await vis.goto(`${U}/autor.html?a=${slug}`);
  await vis.waitForSelector('.lead:has-text("Contos curtos")');
  await vis.waitForSelector('a:has-text("Ler no Entrelinhas")');
  await vis.goto(`${U}/index.html#biblioteca`);
  await vis.waitForSelector('#libraryGrid .book-card:has-text("Cidade Pequena")');

  // 8. atualizar a publicacao: o texto novo so vai ao ar depois de publicar de novo
  await p.click('.st-pm .ProseMirror');
  await p.keyboard.press('End');
  await p.keyboard.type(' Menos o padeiro.', { delay: 5 });
  await salvo(p);
  await ler(vis, `${U}/${href}`);
  assert.ok(!(await vis.innerText('.ler-texto')).includes('padeiro'), 'salvar nao e publicar');
  dlg = await publicarPeloEstudio(p, { faixa: '' });
  await p.locator('dialog a:has-text("Abrir a página de leitura")').waitFor();
  await p.keyboard.press('Escape');
  await ler(vis, `${U}/${href}`);
  await vis.waitForSelector('.ler-texto p:has-text("Menos o padeiro")');

  // 9. tirar do ar: some da leitura e da Biblioteca
  await p.click('.st-bar-btn:has-text("Publicar")');
  dlg = p.locator('dialog.st-pub');
  await dlg.waitFor();
  await dlg.locator('button:has-text("Tirar do ar")').click();
  await p.locator('dialog.st-dialogo:has-text("Tirar a obra do ar?") button:has-text("Tirar do ar")').click();
  await p.waitForFunction(() => !document.querySelector('dialog.st-pub[open]'));
  await vis.goto(`${U}/index.html#biblioteca`);
  await vis.waitForTimeout(800);
  assert.equal(await vis.locator('#libraryGrid .book-card:has-text("Cidade Pequena")').count(), 0, 'saiu da Biblioteca');
  const fora = await app.call('GET', `/api/leitura/${slug}/${href.match(/o=([^&]+)/)[1]}`);
  assert.equal(fora.s, 404, 'a leitura publica responde que nao existe');

  // 10. publicar de novo: volta no mesmo endereco
  await publicarPeloEstudio(p, { faixa: '' });
  await p.locator('dialog a:has-text("Abrir a página de leitura")').waitFor();
  await ler(vis, `${U}/${href}`);
  await vis.waitForSelector('.ler-texto p:has-text("Menos o padeiro")');

  assert.deepEqual(erros, []);
  await ctx.close();
});
