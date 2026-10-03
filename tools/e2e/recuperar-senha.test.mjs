import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { iniciar } from './helpers.mjs';

let E2E;
before(async () => { E2E = await iniciar(); });
after(async () => { await E2E.parar(); });

const perfil = (nome) => JSON.stringify({ nome, frase: '', local: '', bio: '', citacao: '', cor: '#d9a94a', fundo: 'preto', retrato: '', links: [], obras: [], secoes: [] });

test('recuperar senha: moderador gera o link na conta, a pessoa cria a senha nova e entra', async () => {
  const mod = await E2E.novoAutor({ nome: 'Moderadora' });
  E2E.app.db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(mod.id);
  E2E.app.db.prepare('UPDATE profiles SET data = ? WHERE slug = ?').run(perfil('Moderadora'), mod.slug);
  const alvo = E2E.app.addUser({ nome: 'Autor Esquecido' });
  E2E.app.db.prepare('UPDATE profiles SET data = ? WHERE slug = ?').run(perfil('Autor Esquecido'), alvo.slug);

  // tela de login tem o link "Esqueci minha senha"
  const ctx = await E2E.navegador.newContext({ locale: 'pt-BR' });
  const p = await ctx.newPage();
  const erros = [];
  p.on('pageerror', (e) => erros.push(e.message));
  await p.goto(`${E2E.url}/conta.html`);
  await p.click('a:has-text("Esqueci minha senha")');
  await p.fill('input[name=email]', `u${alvo.id}@teste.local`);
  await p.click('button:has-text("Pedir link")');
  await p.waitForSelector('text=entregue por um moderador');

  // moderador: painel na conta
  const m = mod.pagina;
  await m.goto(`${E2E.url}/conta.html`);
  await m.click('#mod-panel summary');
  await m.fill('#mod-busca', 'esquecido');
  assert.equal(await m.locator('.mod-conta').count(), 1);
  await m.click('.mod-conta button:has-text("Gerar link")');
  const link = await m.inputValue('.mod-link input');
  assert.match(link, /\/redefinir\.html\?token=[a-f0-9]{64}$/);

  // a pessoa abre o link e cria a senha nova
  await p.goto(link);
  assert.doesNotMatch(p.url(), /token=/, 'o token sai da barra de endereco');
  await p.fill('input[name=nova]', 'senha-nova-123');
  await p.fill('input[name=conf]', 'senha-nova-123');
  await p.click('button:has-text("Salvar nova senha")');
  await p.waitForURL(/conta\.html$/);
  await p.waitForSelector('input[name=email]');
  await p.fill('input[name=email]', `u${alvo.id}@teste.local`);
  await p.fill('input[name=senha]', 'senha-nova-123');
  await p.click('#authForm button[type=submit]');
  await p.waitForSelector('#ed');
  assert.deepEqual(erros, []);
  assert.deepEqual(mod.erros, []);
  await ctx.close();
});
