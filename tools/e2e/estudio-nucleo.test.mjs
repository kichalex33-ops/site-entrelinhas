import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { iniciar } from './helpers.mjs';

let E2E;
before(async () => { E2E = await iniciar(); });
after(async () => { await E2E.parar(); });

const ESTADO = '.st-estado';
const salvo = (p) => p.waitForFunction(() => document.querySelector('.st-estado')?.dataset.estado === 'salvo', null, { timeout: 15000 });

async function criarObra(a, titulo = 'O Que o Rio Esqueceu', { gaveta = false } = {}) {
  await a.pagina.goto(`${E2E.url}/estudio.html`);
  await a.pagina.click('#st-nova');
  await a.pagina.click('.st-opcao:has-text("Escrever no Entrelinhas")');
  await a.pagina.fill('dialog input', titulo);
  await a.pagina.click('dialog button:has-text("Criar obra")');
  await a.pagina.waitForSelector('.st-explorador .st-nome', { state: gaveta ? 'attached' : 'visible' });
}
async function novoCapitulo(a) {
  await a.pagina.hover('.st-linha:has-text("Manuscrito")');
  await a.pagina.click('button[aria-label="Novo documento em Manuscrito"]');
  await a.pagina.waitForSelector('.st-pm .ProseMirror');
}
const escrever = async (p, texto) => { await p.click('.st-pm .ProseMirror'); await p.keyboard.type(texto, { delay: 5 }); };

test('sem login, o Estudio pede para entrar', async () => {
  const ctx = await E2E.navegador.newContext();
  const p = await ctx.newPage();
  await p.goto(`${E2E.url}/estudio.html`);
  await p.waitForSelector('text=Entre na sua conta');
  assert.ok(await p.locator('a:has-text("Entrar")').count());
  await ctx.close();
});

test('fluxo central: criar obra, escrever, sair, voltar e achar exatamente o mesmo texto', async () => {
  const a = await E2E.novoAutor();
  await criarObra(a);
  const pastas = await a.pagina.locator('.st-explorador .st-rotulo').allInnerTexts();
  assert.deepEqual(pastas, ['Manuscrito', 'Personagens', 'Mundo', 'Pesquisa', 'Ideias', 'Cenas descartadas']);

  await novoCapitulo(a);
  assert.equal(await a.pagina.inputValue('.st-titulo'), 'Capítulo 01');
  await escrever(a.pagina, 'Kayla olhou o rio. “Não esqueça”, disse Márcia.');
  await a.pagina.keyboard.press('Enter');
  await a.pagina.keyboard.type('Segundo parágrafo, com **negrito** e mais texto.');
  await salvo(a.pagina);

  const stats = await a.pagina.innerText('.st-stats');
  assert.match(stats, /Palavras: 15/, stats);
  assert.equal(await a.pagina.locator('.st-pm strong').innerText(), 'negrito', 'atalho **negrito** virou formatacao');

  const antes = await a.pagina.innerText('.st-pm .ProseMirror');
  await a.pagina.reload(); // sair e voltar
  await a.pagina.waitForSelector('.st-pm .ProseMirror p');
  const depois = await a.pagina.innerText('.st-pm .ProseMirror');
  assert.equal(depois, antes, 'texto idêntico depois de recarregar');
  assert.equal(await a.pagina.inputValue('.st-titulo'), 'Capítulo 01', 'a aba foi restaurada');

  // o servidor tem exatamente o que foi digitado, em Markdown
  const obra = a.pagina.url().match(/obra\/([a-f0-9]{12})\/([a-f0-9]{12})/);
  const doc = await a.pagina.evaluate(async ([o, d]) => (await fetch(`/api/studio/works/${o}/docs/${d}`)).json(), [obra[1], obra[2]]);
  assert.ok(doc.corpo.includes('**negrito**') && doc.corpo.includes('“Não esqueça”'), doc.corpo);
  assert.deepEqual(a.erros, []);
  await a.ctx.close();
});

test('atalhos de Markdown e barra de ferramentas', async () => {
  const a = await E2E.novoAutor();
  await criarObra(a);
  await novoCapitulo(a);
  await a.pagina.click('.st-pm .ProseMirror');
  await a.pagina.keyboard.type('# Título grande');
  await a.pagina.keyboard.press('Enter');
  await a.pagina.keyboard.type('- um');
  await a.pagina.keyboard.press('Enter');
  await a.pagina.keyboard.type('dois');
  await a.pagina.keyboard.press('Enter'); await a.pagina.keyboard.press('Enter');
  await a.pagina.keyboard.type('> citação');
  assert.equal(await a.pagina.locator('.st-pm h1').innerText(), 'Título grande');
  assert.equal(await a.pagina.locator('.st-pm li').count(), 2);
  assert.equal(await a.pagina.locator('.st-pm blockquote').count(), 1);
  // botao negrito com selecao
  await a.pagina.keyboard.press('Control+A');
  await a.pagina.click('button[aria-label^="Negrito"]');
  assert.ok(await a.pagina.locator('.st-pm strong').count() > 0);
  await a.pagina.click('button[aria-label^="Desfazer"]');
  await salvo(a.pagina);
  assert.deepEqual(a.erros, []);
  await a.ctx.close();
});

test('separador de cena: --- cria o separador e o cursor segue num paragrafo novo', async () => {
  const a = await E2E.novoAutor();
  await criarObra(a);
  await novoCapitulo(a);
  await escrever(a.pagina, 'Antes da cena.');
  await a.pagina.keyboard.press('Enter');
  await a.pagina.keyboard.type('--- Depois da cena.');
  assert.equal(await a.pagina.locator('.st-pm hr').count(), 1, 'separador criado');
  assert.deepEqual(await a.pagina.locator('.st-pm .ProseMirror > p').allInnerTexts(), ['Antes da cena.', 'Depois da cena.'], 'o texto digitado depois NAO apaga o separador');
  // botao da barra: separador no fim, cursor depois dele
  await a.pagina.click('button[aria-label^="Separador"]');
  await a.pagina.keyboard.type('Terceira cena.');
  assert.equal(await a.pagina.locator('.st-pm hr').count(), 2);
  assert.ok((await a.pagina.innerText('.st-pm .ProseMirror')).includes('Terceira cena.'));
  await salvo(a.pagina);
  const obra = a.pagina.url().match(/obra\/([a-f0-9]{12})\/([a-f0-9]{12})/);
  const doc = await a.pagina.evaluate(async ([o, d]) => (await fetch(`/api/studio/works/${o}/docs/${d}`)).json(), [obra[1], obra[2]]);
  assert.equal((doc.corpo.match(/^(\*\*\*|---)$/gm) || []).length, 2, doc.corpo);
  await a.ctx.close();
});

test('queda de rede nao destroi texto: copia local, recarga e sincronizacao', async () => {
  const a = await E2E.novoAutor();
  await criarObra(a);
  await novoCapitulo(a);
  await escrever(a.pagina, 'Texto que já foi salvo.');
  await salvo(a.pagina);

  // a rede "cai" para salvamentos
  await a.pagina.route('**/api/studio/works/*/docs/*', (rota) => (rota.request().method() === 'PUT' ? rota.abort('internetdisconnected') : rota.continue()));
  await a.pagina.keyboard.type(' E este texto foi digitado sem conexão.');
  await a.pagina.waitForFunction(() => document.querySelector('.st-estado')?.dataset.estado === 'erro', null, { timeout: 15000 });
  assert.match(await a.pagina.innerText(ESTADO), /Sem conexão/);
  const local = await a.pagina.evaluate(() => Object.entries(localStorage).filter(([k]) => k.startsWith('estudio:rascunho:')).map(([, v]) => JSON.parse(v).corpo));
  assert.ok(local.some((c) => c.includes('sem conexão')), 'copia local guardou o texto');

  // o usuario recarrega a pagina ainda sem conexao para salvar: ao voltar (rede ok) o texto e recuperado
  await a.pagina.unroute('**/api/studio/works/*/docs/*');
  await a.pagina.reload();
  await a.pagina.waitForSelector('.st-pm .ProseMirror p');
  await salvo(a.pagina);
  const txt = await a.pagina.innerText('.st-pm .ProseMirror');
  assert.ok(txt.includes('Texto que já foi salvo.') && txt.includes('digitado sem conexão'), txt);
  const obra = a.pagina.url().match(/obra\/([a-f0-9]{12})\/([a-f0-9]{12})/);
  const doc = await a.pagina.evaluate(async ([o, d]) => (await fetch(`/api/studio/works/${o}/docs/${d}`)).json(), [obra[1], obra[2]]);
  assert.ok(doc.corpo.includes('digitado sem conexão'), 'servidor recebeu o texto recuperado');
  await a.ctx.close();
});

test('o autosave tenta de novo sozinho quando a rede volta', async () => {
  const a = await E2E.novoAutor();
  await criarObra(a);
  await novoCapitulo(a);
  let falhas = 0;
  await a.pagina.route('**/api/studio/works/*/docs/*', (rota) => (rota.request().method() === 'PUT' && falhas++ < 2 ? rota.abort('connectionreset') : rota.continue()));
  await escrever(a.pagina, 'Vai falhar duas vezes e depois salvar.');
  await a.pagina.waitForFunction(() => document.querySelector('.st-estado')?.dataset.estado === 'erro', null, { timeout: 15000 });
  await salvo(a.pagina); // espera crescente: 3 s + 6 s
  assert.ok(falhas >= 3);
  await a.ctx.close();
}, { timeout: 40000 });

test('abas: alternar entre documentos nao perde o que nao foi salvo', async () => {
  const a = await E2E.novoAutor();
  await criarObra(a);
  await novoCapitulo(a);
  await escrever(a.pagina, 'Primeiro capítulo, texto A.');
  await a.pagina.hover('.st-linha:has-text("Manuscrito")');
  await a.pagina.click('button[aria-label="Novo documento em Manuscrito"]');
  await a.pagina.waitForFunction(() => document.querySelector('.st-titulo')?.value === 'Capítulo 02');
  await escrever(a.pagina, 'Segundo capítulo, texto B.');
  assert.equal(await a.pagina.locator('.st-aba').count(), 2);
  await a.pagina.click('.st-aba-nome:has-text("Capítulo 01")');
  assert.match(await a.pagina.innerText('.st-pm .ProseMirror'), /texto A/);
  await a.pagina.click('.st-aba-nome:has-text("Capítulo 02")');
  assert.match(await a.pagina.innerText('.st-pm .ProseMirror'), /texto B/);
  await salvo(a.pagina);
  await a.ctx.close();
});

test('desfazer continua funcionando depois de trocar de aba', async () => {
  const a = await E2E.novoAutor();
  await criarObra(a);
  await novoCapitulo(a);
  await escrever(a.pagina, 'texto original');
  await a.pagina.hover('.st-linha:has-text("Manuscrito")');
  await a.pagina.click('button[aria-label="Novo documento em Manuscrito"]');
  await a.pagina.waitForFunction(() => document.querySelector('.st-titulo')?.value === 'Capítulo 02');
  await a.pagina.click('.st-aba-nome:has-text("Capítulo 01")');
  await a.pagina.click('.st-pm .ProseMirror');
  await a.pagina.keyboard.press('Control+End');
  await a.pagina.keyboard.type(' ACRESCENTADO');
  await a.pagina.keyboard.press('Control+Z');
  await a.pagina.keyboard.press('Control+Z');
  const t = await a.pagina.innerText('.st-pm .ProseMirror');
  assert.ok(!t.includes('ACRESCENTADO'), t);
  await a.ctx.close();
});

test('arrastar e soltar reorganiza e o servidor guarda a ordem', async () => {
  const a = await E2E.novoAutor();
  await criarObra(a);
  for (let i = 0; i < 3; i++) { await a.pagina.hover('.st-linha:has-text("Manuscrito")'); await a.pagina.click('button[aria-label="Novo documento em Manuscrito"]'); await a.pagina.waitForFunction((n) => document.querySelector('.st-titulo')?.value === `Capítulo 0${n}`, i + 1); }
  const ordem = async () => a.pagina.locator('.st-linha:has(button.st-nome:has-text("Capítulo")) .st-rotulo').allInnerTexts();
  assert.deepEqual(await ordem(), ['Capítulo 01', 'Capítulo 02', 'Capítulo 03']);
  await a.pagina.locator('.st-linha:has-text("Capítulo 03")').dragTo(a.pagina.locator('.st-linha:has-text("Capítulo 01")'), { targetPosition: { x: 40, y: 3 } });
  await a.pagina.waitForFunction(() => document.querySelector('.st-arvore .st-arvore .st-rotulo')?.textContent === 'Capítulo 03');
  assert.deepEqual(await ordem(), ['Capítulo 03', 'Capítulo 01', 'Capítulo 02']);
  await a.pagina.reload();
  await a.pagina.waitForSelector('.st-explorador .st-nome');
  assert.deepEqual(await ordem(), ['Capítulo 03', 'Capítulo 01', 'Capítulo 02'], 'ordem persistiu');
  await a.ctx.close();
});

test('lixeira: enviar, ver, restaurar', async () => {
  const a = await E2E.novoAutor();
  await criarObra(a);
  await novoCapitulo(a);
  await a.pagina.hover('.st-linha:has-text("Capítulo 01")');
  await a.pagina.click('button[aria-label="Mais ações para Capítulo 01"]');
  await a.pagina.click('.st-menu-item:has-text("Enviar para a lixeira")');
  await a.pagina.click('dialog button:has-text("Enviar para a lixeira")');
  await a.pagina.waitForFunction(() => ![...document.querySelectorAll('.st-rotulo')].some((e) => e.textContent === 'Capítulo 01'));
  await a.pagina.click('button:has-text("Lixeira")');
  await a.pagina.waitForSelector('.st-lixeira li:has-text("Capítulo 01")');
  await a.pagina.click('.st-lixeira li:has-text("Capítulo 01") button:has-text("Restaurar")');
  await a.pagina.keyboard.press('Escape');
  await a.pagina.waitForSelector('.st-rotulo:text-is("Capítulo 01")');
  await a.ctx.close();
});

test('modo foco esconde os paineis e Esc volta', async () => {
  const a = await E2E.novoAutor();
  await criarObra(a);
  await novoCapitulo(a);
  await a.pagina.click('#st-foco-btn');
  assert.equal(await a.pagina.locator('.st-explorador').isVisible(), false);
  assert.equal(await a.pagina.locator('.st-contexto').isVisible(), false);
  assert.equal(await a.pagina.locator('.st-bar').isVisible(), false);
  assert.equal(await a.pagina.locator('.st-pm .ProseMirror').isVisible(), true);
  await a.pagina.keyboard.press('Escape');
  assert.equal(await a.pagina.locator('.st-explorador').isVisible(), true);
  await a.ctx.close();
});

test('modo Markdown: editar em Markdown e voltar ao visual', async () => {
  const a = await E2E.novoAutor();
  await criarObra(a);
  await novoCapitulo(a);
  await escrever(a.pagina, 'Linha inicial.');
  await a.pagina.click('.st-modo');
  assert.equal(await a.pagina.locator('.st-md').isVisible(), true);
  await a.pagina.fill('.st-md', '# Título em Markdown\n\nTexto com *itálico*.');
  await a.pagina.click('.st-modo');
  assert.equal(await a.pagina.locator('.st-pm h1').innerText(), 'Título em Markdown');
  assert.equal(await a.pagina.locator('.st-pm em').innerText(), 'itálico');
  await salvo(a.pagina);
  await a.ctx.close();
});

test('painel de contexto, redimensionar e esconder paineis', async () => {
  const a = await E2E.novoAutor();
  await criarObra(a);
  await novoCapitulo(a);
  await escrever(a.pagina, 'Uma duas três');
  assert.match(await a.pagina.innerText('.st-contexto'), /Palavras\s*3/);
  const antes = (await a.pagina.locator('.st-explorador').boundingBox()).width;
  const alca = await a.pagina.locator('[data-lado="esq"]').boundingBox();
  await a.pagina.mouse.move(alca.x + 3, alca.y + 100); await a.pagina.mouse.down(); await a.pagina.mouse.move(alca.x + 103, alca.y + 100, { steps: 6 }); await a.pagina.mouse.up();
  const depois = (await a.pagina.locator('.st-explorador').boundingBox()).width;
  assert.ok(depois > antes + 50, `${antes} -> ${depois}`);
  await a.pagina.click('#st-tg-exp');
  assert.equal(await a.pagina.locator('.st-explorador').isVisible(), false);
  assert.ok((await a.pagina.locator('.st-pm .ProseMirror').boundingBox()).width > 400, 'o editor continua visivel e largo com o explorador escondido');
  await a.pagina.click('#st-tg-ctx');
  assert.ok((await a.pagina.locator('.st-pm .ProseMirror').boundingBox()).width > 600, 'e com os dois paineis escondidos');
  await a.ctx.close();
});

test('isolamento: outro autor nao abre a obra nem os documentos', async () => {
  const a = await E2E.novoAutor();
  await criarObra(a, 'Obra privada da A');
  await novoCapitulo(a);
  await escrever(a.pagina, 'segredo da autora A');
  await salvo(a.pagina);
  const link = a.pagina.url();
  const b = await E2E.novoAutor({ nome: 'Autor B' });
  await b.pagina.goto(link);
  await b.pagina.waitForSelector('text=Obra não encontrada');
  assert.ok(!(await b.pagina.content()).includes('segredo da autora A'));
  await b.pagina.goto(`${E2E.url}/estudio.html`);
  await b.pagina.waitForSelector('text=Você ainda não tem obras');
  await a.ctx.close(); await b.ctx.close();
});

test('celular: explorador e contexto viram gavetas e o editor ocupa a tela', async () => {
  const a = await E2E.novoAutor({ viewport: { width: 390, height: 800 } });
  await criarObra(a, 'Obra no celular', { gaveta: true });
  assert.equal(await a.pagina.locator('.st-explorador').isVisible(), false, 'explorador fechado no celular');
  await a.pagina.click('#st-tg-exp');
  assert.equal(await a.pagina.locator('.st-explorador').isVisible(), true);
  await a.pagina.hover('.st-linha:has-text("Manuscrito")').catch(() => {});
  await a.pagina.click('button[aria-label="Novo documento em Manuscrito"]');
  await a.pagina.waitForSelector('.st-pm .ProseMirror');
  await a.pagina.click('#st-tg-exp').catch(() => {});
  await escrever(a.pagina, 'Escrevendo no celular.');
  await salvo(a.pagina);
  const m = await a.pagina.locator('.st-pm .ProseMirror').boundingBox();
  assert.ok(m.width > 300, `editor largo: ${m.width}`);
  const rolagem = await a.pagina.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  assert.equal(rolagem, false, 'sem rolagem horizontal');
  await a.ctx.close();
});
