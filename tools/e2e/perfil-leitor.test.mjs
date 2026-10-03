import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { iniciar } from './helpers.mjs';

let E2E;
before(async () => { E2E = await iniciar(); });
after(async () => { await E2E.parar(); });

const perfilAutor = (nome, obras) => JSON.stringify({ nome, frase: '', local: '', bio: '', citacao: '', cor: '#d9a94a', fundo: 'preto', retrato: '', links: [], secoes: [], obras });

test('leitor: estante pela pagina do livro, segue o autor, ve tudo no perfil e pode deixa-lo privado', async () => {
  const a = await E2E.novoAutor({ nome: 'Ana Autora' });
  const obra = 'abcdef0000aa';
  E2E.app.db.prepare('UPDATE profiles SET data = ? WHERE slug = ?').run(perfilAutor('Ana Autora', [{ id: obra, titulo: 'O Rio', genero: 'Fantasia', status: 'Publicado', sinopse: 'x', capa: '', link: '', lojas: [], faixa: '', publicado_em: '' }]), a.slug);
  const l = E2E.app.addUser({ role: 'leitor', nome: 'Lia' });
  const ctx = await E2E.navegador.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addCookies([{ name: 'sid', value: l.tok, url: E2E.url }]);
  const p = await ctx.newPage();
  const erros = [];
  p.on('pageerror', (e) => erros.push(e.message));

  // menu: "Meu perfil" so para o leitor, marcado na propria pagina de perfil
  await p.goto(`${E2E.url}/index.html`);
  await p.waitForSelector(`.site-header .tabs a.tab[href="leitor.html?u=${l.slug}"]:has-text("Meu perfil")`);
  await a.pagina.goto(`${E2E.url}/index.html`);
  await a.pagina.waitForTimeout(500);
  assert.equal(await a.pagina.locator('.tabs a:has-text("Meu perfil")').count(), 0, 'autor nao ganha o item');
  await p.goto(`${E2E.url}/leitor.html?u=${l.slug}`);
  await p.waitForSelector('.tabs a.tab.active:has-text("Meu perfil")');

  // estante pela pagina do livro
  await p.goto(`${E2E.url}/obra.html?a=${a.slug}&o=${obra}`);
  await p.click('[data-estante]');
  await p.check('.est-fixas label:has-text("Lendo") input');
  await p.waitForSelector('.est-fixas label:has-text("Lendo") input:checked');
  await p.fill('.est-nova input', 'Para as férias');
  await p.click('.est-nova button');
  await p.waitForSelector('.est-proprias label:has-text("Para as férias") input:checked');
  await p.click('dialog button:has-text("Pronto")');

  // segue a autora
  await p.goto(`${E2E.url}/autor.html?a=${a.slug}`);
  await p.click('#seguirBtn:has-text("Seguir")');
  await p.waitForSelector('#seguidores:has-text("1 seguidor")');

  // perfil
  await p.goto(`${E2E.url}/leitor.html?u=${l.slug}`);
  await p.waitForSelector('.lt-livro:has-text("O Rio") .lt-status:has-text("Lendo")');
  await p.click('.chip:has-text("Para as férias")');
  await p.waitForSelector('.lt-grade .lt-livro:has-text("O Rio")');
  await p.click('[data-aba=atividade]');
  await p.waitForSelector('.lt-atividade :text("Começou a ler")');
  await p.click('[data-aba=seguindo]');
  await p.waitForSelector('.lt-seguindo a:has-text("Ana Autora")');

  // engrenagem: perfil privado
  await p.click('[data-config]');
  await p.uncheck('dialog [data-privado]');
  await p.waitForSelector('.lt-nome .aj-tag:has-text("privado")');
  await p.click('dialog [data-fechar]');
  const anon = await (await E2E.navegador.newContext()).newPage();
  await anon.goto(`${E2E.url}/leitor.html?u=${l.slug}`);
  await anon.waitForSelector('.lt-privado:has-text("Este perfil é privado")');
  assert.equal(await anon.locator('.lt-grade').count(), 0);
  assert.deepEqual(erros, []);
  await ctx.close();
});
