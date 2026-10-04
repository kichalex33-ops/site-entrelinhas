import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { iniciar } from './helpers.mjs';

let E2E;
before(async () => { E2E = await iniciar(); });
after(async () => { await E2E.parar(); });

test('entrada: quem quer ler ve "Criar conta" de leitor; o cadastro de autor fica a parte, por convite', async () => {
  const ctx = await E2E.navegador.newContext({ locale: 'pt-BR' });
  const p = await ctx.newPage();
  const erros = []; p.on('pageerror', (e) => erros.push(e.message));

  // Autores: o convite e para o leitor, nao "Area do autor"
  await p.goto(`${E2E.url}/autores.html`);
  assert.equal(await p.locator('text=Área do autor').count(), 0);
  await p.waitForSelector('.topo-acoes .topo-criar');
  await p.click('#ctaLeitor a:has-text("Criar conta de leitor")');
  await p.waitForSelector('#authForm input[name=nome][maxlength="40"]');
  assert.equal(await p.locator('.auth-tabs button.on').textContent(), 'Criar conta');
  assert.equal(await p.locator('#authForm input[name=convite]').count(), 0, 'leitor nao ve campo de convite');
  assert.match(await p.innerText('#authForm button[type=submit]'), /Criar conta de leitor/i);

  // autor: link separado, com o convite
  await p.click('.auth-autor button:has-text("Criar conta de autor")');
  await p.waitForSelector('#authForm input[name=convite]');
  assert.equal(await p.locator('.auth-tabs').count(), 0);
  await p.click('.auth-volta button');
  await p.waitForSelector('.auth-tabs button.on:has-text("Criar conta")');

  // criar a conta de leitor de verdade (sem captcha no ambiente de teste)
  await p.fill('#authForm input[name=nome]', 'Lia Leitora');
  await p.fill('#authForm input[name=email]', 'lia@teste.local');
  await p.fill('#authForm input[name=senha]', 'senha-bem-longa');
  await p.click('#authForm button[type=submit]');
  await p.waitForSelector('#leitorForm');

  // logada: o convite some da pagina de autores e o topo mostra a conta
  await p.goto(`${E2E.url}/autores.html`);
  await p.waitForSelector('.topo-foto');
  await p.waitForFunction(() => document.getElementById('ctaLeitor').hidden);
  assert.equal(await p.locator('.topo-criar').count(), 0);

  // rodape: "Minha conta" em vez de "Area do autor"
  await p.goto(`${E2E.url}/index.html`);
  assert.equal(await p.locator('footer a:has-text("Minha conta")').count(), 1);
  assert.deepEqual(erros, []);
  await ctx.close();
});
