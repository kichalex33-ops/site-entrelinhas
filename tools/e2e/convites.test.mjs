import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { iniciar } from './helpers.mjs';

let E2E;
before(async () => { E2E = await iniciar(); });
after(async () => { await E2E.parar(); });

const perfil = (nome) => JSON.stringify({ nome, frase: '', local: '', bio: '', citacao: '', cor: '#d9a94a', fundo: 'preto', retrato: '', links: [], obras: [], secoes: [] });

test('convite: moderador gera no painel, a pessoa abre o link e cria a conta de autor', async () => {
  const mod = await E2E.novoAutor({ nome: 'Moderadora' });
  E2E.app.db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(mod.id);
  E2E.app.db.prepare('UPDATE profiles SET data = ? WHERE slug = ?').run(perfil('Moderadora'), mod.slug);
  const m = mod.pagina;
  await m.goto(`${E2E.url}/conta.html`);
  await m.click('#mod-convites summary');
  await m.fill('#mod-conv-form input[name=para]', 'Maria dos contos');
  await m.click('#mod-conv-form button');
  const msg = await m.inputValue('.mod-conv-ok textarea');
  const link = msg.match(/https?:\/\/\S+#convite=[A-Z0-9-]+/)[0];
  await m.waitForSelector('.mod-conv-ul li:has-text("Maria dos contos"):has-text("aguardando cadastro")');

  const ctx = await E2E.navegador.newContext({ locale: 'pt-BR' });
  const p = await ctx.newPage();
  const erros = [];
  p.on('pageerror', (e) => erros.push(e.message));
  await p.goto(link);
  await p.waitForSelector('#authForm input[name=convite]');
  assert.equal(await p.inputValue('#authForm input[name=convite]'), link.split('#convite=')[1]);
  assert.doesNotMatch(p.url(), /convite=/, 'o codigo sai da barra de endereco');
  await p.fill('#authForm input[name=nome]', 'Maria Contista');
  await p.fill('#authForm input[name=email]', 'maria@teste.local');
  await p.fill('#authForm input[name=senha]', 'senha-segura-123');
  await p.check('#authForm input[name=aceite]');
  await p.click('#authForm button[type=submit]');
  await p.waitForSelector('#ed');

  await m.reload();
  await m.click('#mod-convites summary');
  await m.waitForSelector('.mod-conv-ul li:has-text("Maria dos contos"):has-text("usado")');
  assert.deepEqual(erros, []);
  assert.deepEqual(mod.erros, []);
  await ctx.close();
});
