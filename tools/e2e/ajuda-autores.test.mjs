import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { iniciar } from './helpers.mjs';

let E2E;
before(async () => { E2E = await iniciar(); });
after(async () => { await E2E.parar(); });

test('leitura beta: a autora pede, outro autor se oferece, ela aceita e conclui; ele ganha o selo', async () => {
  const ana = await E2E.novoAutor({ nome: 'Ana Beta' });
  const beto = await E2E.novoAutor({ nome: 'Beto Leitor' });

  // o cartao do servico leva ao quadro
  await ana.pagina.goto(`${E2E.url}/index.html#servicos`);
  await ana.pagina.click('.service-link');
  await ana.pagina.waitForSelector('[data-novo]');
  await ana.pagina.click('[data-novo]');
  await ana.pagina.fill('#novo [name=titulo]', 'O Rio');
  await ana.pagina.fill('#novo [name=descricao]', 'Uma menina que lembra de tudo segue o rio até o mar.');
  await ana.pagina.fill('#novo [name=acesso]', 'https://docs.exemplo.com/rio');
  await ana.pagina.click('#novo button[type=submit]');
  await ana.pagina.waitForSelector('.aj-card:has-text("Ninguém se ofereceu ainda")');

  const b = beto.pagina;
  await b.goto(`${E2E.url}/ajuda.html`);
  await b.waitForSelector('.aj-card:has-text("O Rio")');
  assert.doesNotMatch(await b.innerText('main'), /docs\.exemplo\.com/, 'link escondido antes do aceite');
  await b.fill('.aj-oferta [name=msg]', 'Entrego em uma semana.');
  await b.click('.aj-oferta button');
  await b.waitForSelector('.aj-st:has-text("aguardando resposta")');

  await ana.pagina.reload();
  await ana.pagina.click('button:has-text("Aceitar")');
  await ana.pagina.waitForSelector('button:has-text("Recebi o retorno")');

  await b.reload();
  await b.waitForSelector('.aj-acesso a[href="https://docs.exemplo.com/rio"]');
  // so quem foi aceito ve o original: um terceiro autor continua sem o link
  const caio = await E2E.novoAutor({ nome: 'Caio' });
  await caio.pagina.goto(`${E2E.url}/ajuda.html`);
  await caio.pagina.waitForSelector('.aj-card:has-text("O Rio")');
  assert.doesNotMatch(await caio.pagina.innerText('main'), /docs\.exemplo\.com/, 'link so para quem foi aceito');
  assert.ok(!JSON.stringify((await E2E.app.call('GET', '/api/ajuda', { tok: caio.tok })).j).includes('docs.exemplo.com'), 'nem pela API');

  await ana.pagina.click('button:has-text("Recebi o retorno")');
  await ana.pagina.waitForSelector('.aj-tag.aj-concluido');

  const perfil = await (await fetch(`${E2E.url}/api/profile/${beto.slug}`)).json();
  assert.deepEqual(perfil.badges, ['Leitor beta']);
  assert.deepEqual(ana.erros, []);
  assert.deepEqual(beto.erros, []);
});
