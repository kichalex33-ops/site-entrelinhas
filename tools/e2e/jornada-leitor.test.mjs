// Jornada completa do leitor, so pela interface: criar conta -> confirmar e-mail -> seguir autor -> estante ->
// favoritar -> ler -> avaliar -> trocar senha -> recuperar senha pelo e-mail -> apagar conta.
// O Resend e simulado neste processo (o Worker roda aqui): os e-mails sao capturados, nada sai para a internet.
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

const linkDo = (assunto) => {
  const m = [...caixa].reverse().find((x) => x.subject.includes(assunto));
  return m && m.text.match(/https?:\/\/\S+token=[a-f0-9]{64}/)[0];
};

test('jornada do leitor: cadastro, confirmacao, seguir, estante, favorito, leitura, avaliacao, senha e apagar conta', async () => {
  const { app } = E2E;
  // uma autora com um livro divulgado e uma obra publicada pelo Estudio
  const a = app.addUser({ nome: 'Ana Autora' });
  const rp = await app.call('PUT', '/api/profile', { tok: a.tok, body: { data: { nome: 'Ana Autora', links: [], secoes: [], obras: [{ titulo: 'O Rio', status: 'Publicado', sinopse: 'Uma menina e um rio.', genero: 'Fantasia' }] } } });
  const obra = rp.j.data.obras[0].id;
  const w = (await app.call('POST', '/api/studio/works', { tok: a.tok, body: { titulo: 'A Ponte' } })).j.id;
  const c = (await app.call('POST', `/api/studio/works/${w}/docs`, { tok: a.tok, body: { doc_tipo: 'capitulo', titulo: 'Capítulo 1', corpo: 'Era uma vez uma ponte sobre o rio.' } })).j.id;
  const dec = (await app.call('GET', `/api/studio/works/${w}/publicacao`, { tok: a.tok })).j.declaracao.versao;
  const pub = (await app.call('POST', `/api/studio/works/${w}/publicacao`, { tok: a.tok, body: { acao: 'publicar', aceite: dec, meta: { titulo: 'A Ponte', sinopse: 'Uma ponte.', genero: 'Drama', faixa: '12' }, docs: [c] } })).j;

  const ctx = await E2E.navegador.newContext({ viewport: { width: 390, height: 860 }, locale: 'pt-BR' });
  const p = await ctx.newPage();
  const erros = [];
  p.on('pageerror', (e) => erros.push(e.message));
  const U = E2E.url;

  // 1. criar conta de leitor (aceite obrigatorio)
  await p.goto(`${U}/conta.html#criar`);
  await p.fill('#authForm input[name=nome]', 'Lia Leitora');
  await p.fill('#authForm input[name=email]', 'lia@teste.local');
  await p.fill('#authForm input[name=senha]', 'senha-bem-longa');
  await p.check('#authForm input[name=aceite]');
  await p.click('#authForm button[type=submit]');
  await p.waitForSelector('.aviso-email:has-text("Confirme seu e-mail")');

  // 2. sem confirmar, avaliar e bloqueado (ler e navegar nao)
  await p.goto(`${U}/obra.html?a=${a.slug}&o=${obra}#avaliacoes`);
  await p.click('[data-aba=avaliacoes]');
  await p.fill('.rev-form textarea[name=texto]', 'Li em uma noite so, recomendo muito.');
  await p.click('.rev-form button[type=submit]');
  await p.waitForSelector('.rev-note:has-text("Confirme seu e-mail")');

  // 3. confirmar pelo link do e-mail
  const confirmar = linkDo('Confirme seu e-mail');
  assert.ok(confirmar, 'o e-mail de confirmacao chegou');
  await p.goto(confirmar);
  await p.waitForSelector('.note.ok:has-text("E-mail confirmado")');
  assert.ok(!p.url().includes('token='), 'o token sai da barra de endereco');
  await p.goto(`${U}/conta.html`);
  await p.waitForSelector('#leitorForm');
  assert.equal(await p.locator('.aviso-email').count(), 0);

  // 4. seguir a autora (no perfil do autor)
  await p.goto(`${U}/autor.html?a=${a.slug}`);
  await p.click('#seguirBtn:has-text("Seguir")');
  await p.waitForSelector('#seguirBtn:has-text("Seguindo")');

  // 5. estante e favorito na pagina do livro
  await p.goto(`${U}/obra.html?a=${a.slug}&o=${obra}`);
  await p.click('[data-estante]');
  await p.check('.est-fixas label:has-text("Lendo") input');
  await p.waitForSelector('.est-fixas label:has-text("Lendo") input:checked');
  await p.click('dialog button:has-text("Pronto")');
  await p.click('[data-favoritar]');
  await p.waitForSelector('[data-favoritar][aria-pressed="true"]');

  // 6. ler a obra publicada
  await p.goto(`${U}/ler.html?a=${a.slug}&o=${pub.slug}`);
  await p.waitForSelector('.ler-sumario li');
  await p.click('a:has-text("Começar a ler")');
  await p.waitForSelector('.ler-texto p:has-text("Era uma vez uma ponte")');

  // 7. avaliar (agora confirmado)
  await p.goto(`${U}/obra.html?a=${a.slug}&o=${obra}`);
  await p.click('[data-aba=avaliacoes]');
  await p.fill('.rev-form textarea[name=texto]', 'Li em uma noite so, recomendo muito.');
  await p.click('.rev-form button[type=submit]');
  await p.waitForSelector('.rev-item:has-text("Li em uma noite so")');
  // a avaliacao aparece no perfil da autora (nota media), nao no perfil da leitora
  await p.goto(`${U}/autor.html?a=${a.slug}`);
  await p.waitForSelector('.autor-nota:has-text("1 avaliação")');

  // 8. trocar a senha
  await p.goto(`${U}/conta.html`);
  await p.click('details.pw:not(.apagar-conta) summary');
  await p.fill('#pwForm input[name=atual]', 'senha-bem-longa');
  await p.fill('#pwForm input[name=nova]', 'senha-nova-mais-longa');
  await p.click('#pwForm button[type=submit]');
  await p.waitForFunction(() => /trocad|alterad|salv/i.test(document.getElementById('pwNote').textContent));

  // 9. sair e recuperar a senha pelo e-mail
  await p.click('#logout');
  await p.waitForSelector('#authForm');
  await p.goto(`${U}/recuperar.html`);
  await p.fill('#f input[name=email]', 'lia@teste.local');
  await p.click('#f button[type=submit]');
  await p.waitForTimeout(500);
  const redefinir = linkDo('Redefinir sua senha');
  assert.ok(redefinir, 'o e-mail de recuperacao chegou');
  await p.goto(redefinir);
  await p.fill('#f input[name=nova]', 'terceira-senha-123');
  await p.fill('#f input[name=conf]', 'terceira-senha-123');
  await p.click('#f button[type=submit]');
  await p.waitForURL(/conta\.html/);
  await p.waitForSelector('#authForm');
  await p.fill('#authForm input[name=email]', 'lia@teste.local');
  await p.fill('#authForm input[name=senha]', 'terceira-senha-123');
  await p.click('#authForm button[type=submit]');
  await p.waitForSelector('#leitorForm');

  // 10. apagar a conta
  await p.click('details.apagar-conta summary');
  await p.fill('#apagarForm input[name=senha]', 'terceira-senha-123');
  await p.fill('#apagarForm input[name=confirmar]', 'APAGAR');
  await p.click('#apagarForm button[type=submit]');
  await p.waitForSelector('text=Sua conta foi apagada');
  assert.equal(app.db.prepare("SELECT COUNT(*) AS n FROM users WHERE email = 'lia@teste.local'").get().n, 0);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM reviews').get().n, 0, 'a avaliacao saiu junto');
  assert.deepEqual(erros, []);
  await ctx.close();
});
