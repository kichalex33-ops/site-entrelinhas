import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { iniciar } from './helpers.mjs';

let E2E;
before(async () => { E2E = await iniciar(); });
after(async () => { await E2E.parar(); });

const salvo = (p) => p.waitForFunction(() => document.querySelector('.st-estado')?.dataset.estado === 'salvo', null, { timeout: 15000 });

// cria obra + documentos pela API e abre o primeiro
async function preparar(a, docs) {
  const p = a.pagina;
  await p.goto(`${E2E.url}/estudio.html`);
  await p.click('#st-nova'); await p.click('.st-opcao:has-text("Escrever no Entrelinhas")');
  await p.fill('dialog input', 'Obra'); await p.click('dialog button:has-text("Criar obra")');
  await p.waitForSelector('.st-explorador .st-nome');
  const obra = p.url().match(/obra\/([a-f0-9]{12})/)[1];
  const ids = await p.evaluate(async ([obra, docs]) => {
    const H = { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' };
    const w = await (await fetch(`/api/studio/works/${obra}`)).json();
    const pasta = (t) => w.itens.find((i) => i.doc_tipo === t).id;
    const out = [];
    for (const d of docs) {
      const c = await (await fetch(`/api/studio/works/${obra}/docs`, { method: 'POST', headers: H, body: JSON.stringify({ pai: pasta(d.pasta), doc_tipo: d.tipo, titulo: d.titulo }) })).json();
      if (d.corpo) await fetch(`/api/studio/works/${obra}/docs/${c.id}`, { method: 'PUT', headers: H, body: JSON.stringify({ versao_base: 1, corpo: d.corpo }) });
      out.push(c.id);
    }
    return out;
  }, [obra, docs]);
  await p.goto(`${E2E.url}/estudio.html#/obra/${obra}`);
  await p.reload();
  await p.waitForSelector('.st-explorador .st-nome');
  return { obra, ids };
}
const abrir = async (p, titulo) => { await p.click(`.st-nome:has-text("${titulo}")`); await p.waitForFunction((t) => document.querySelector('.st-titulo')?.value === t, titulo); };
const docJson = (p, obra, id) => p.evaluate(async ([o, d]) => (await fetch(`/api/studio/works/${o}/docs/${d}`)).json(), [obra, id]);

test('digitar [[ abre o autocompletar; Enter insere o link; o link persiste como [[Titulo]]', async () => {
  const a = await E2E.novoAutor();
  const { obra, ids } = await preparar(a, [
    { pasta: 'personagens', tipo: 'personagem', titulo: 'Kayla', corpo: 'Quinze anos.' },
    { pasta: 'personagens', tipo: 'personagem', titulo: 'Kayla infância', corpo: '' },
    { pasta: 'mundo', tipo: 'lugar', titulo: 'Casa de Kayla', corpo: '' },
    { pasta: 'personagens', tipo: 'personagem', titulo: 'Max', corpo: '' },
    { pasta: 'manuscrito', tipo: 'capitulo', titulo: 'Capítulo 03', corpo: '' },
  ]);
  const p = a.pagina;
  await abrir(p, 'Capítulo 03');
  await p.click('.st-pm .ProseMirror');
  await p.keyboard.type('Quando ');
  await p.keyboard.type('[[Ka', { delay: 30 });
  await p.waitForSelector('.st-link-pop .st-link-op');
  const opcoes = await p.locator('.st-link-op span:first-child').allInnerTexts();
  assert.deepEqual(opcoes.slice(0, 3), ['Kayla', 'Kayla infância', 'Casa de Kayla'], 'prefixo primeiro, depois quem contem; ' + opcoes.join('|'));
  assert.ok(!opcoes.includes('Max'));
  await p.keyboard.press('Enter');
  assert.equal(await p.locator('.st-link-pop').count(), 0, 'popup fecha');
  assert.equal(await p.locator('.st-pm .st-wikilink').innerText(), 'Kayla');
  assert.ok(await p.locator('.st-pm .st-wikilink.ok').count(), 'link existente nao e marcado como quebrado');
  await p.keyboard.type(' viu [[Max]] na margem.', { delay: 10 }); // [[Max]] completo vira link sozinho
  assert.equal(await p.locator('.st-pm .st-wikilink').count(), 2);
  await salvo(p);
  const doc = await docJson(p, obra, ids[4]);
  assert.match(doc.corpo, /Quando \[\[Kayla\]\] viu \[\[Max\]\] na margem\./, doc.corpo);
  assert.ok(!doc.corpo.includes('\\['), 'colchetes sem escape');
  // modo Markdown mostra [[...]]
  await p.click('.st-modo');
  assert.match(await p.inputValue('.st-md'), /\[\[Kayla\]\]/);
  await p.click('.st-modo');
  assert.equal(await p.locator('.st-pm .st-wikilink').count(), 2, 'volta a ser link no modo visual');
  assert.deepEqual(a.erros, []);
  await a.ctx.close();
});

test('autocompletar: setas navegam, Esc fecha sem inserir e o texto digitado fica', async () => {
  const a = await E2E.novoAutor();
  await preparar(a, [
    { pasta: 'personagens', tipo: 'personagem', titulo: 'Márcia', corpo: '' },
    { pasta: 'personagens', tipo: 'personagem', titulo: 'Marta', corpo: '' },
    { pasta: 'manuscrito', tipo: 'capitulo', titulo: 'Cap', corpo: '' },
  ]);
  const p = a.pagina;
  await abrir(p, 'Cap');
  await p.click('.st-pm .ProseMirror');
  await p.keyboard.type('[[mar', { delay: 30 });
  await p.waitForSelector('.st-link-op');
  assert.equal(await p.locator('.st-link-op:not(:has-text("Criar"))').count(), 2, 'busca sem acento e sem caixa (Marcia e Marta)');
  assert.equal(await p.locator('.st-link-op:has-text("Criar")').count(), 1, 'e a opcao de criar um documento novo');
  await p.keyboard.press('ArrowDown');
  assert.match(await p.locator('.st-link-op.sel').innerText(), /Marta/);
  await p.keyboard.press('Escape');
  assert.equal(await p.locator('.st-link-pop').count(), 0);
  assert.equal(await p.locator('.st-pm .st-wikilink').count(), 0, 'Esc nao insere');
  assert.match(await p.innerText('.st-pm .ProseMirror'), /\[\[mar/, 'texto continua como estava');
  assert.equal(await p.locator('.st-titulo').inputValue(), 'Cap', 'Esc nao fechou nada alem do popup');
  await a.ctx.close();
});

test('criar documento direto do autocompletar: link inserido e destino criado em Ideias', async () => {
  const a = await E2E.novoAutor();
  const { obra } = await preparar(a, [{ pasta: 'manuscrito', tipo: 'capitulo', titulo: 'Cap', corpo: '' }]);
  const p = a.pagina;
  await abrir(p, 'Cap');
  await p.click('.st-pm .ProseMirror');
  await p.keyboard.type('Veja [[Regra dos Nomes', { delay: 15 });
  await p.waitForSelector('.st-link-op:has-text("Criar")');
  await p.click('.st-link-op:has-text("Criar")');
  await p.waitForFunction(() => [...document.querySelectorAll('.st-rotulo')].some((e) => e.textContent === 'Regra dos Nomes'));
  assert.equal(await p.locator('.st-pm .st-wikilink').innerText(), 'Regra dos Nomes');
  await p.waitForFunction(() => document.querySelector('.st-wikilink.ok'), null, { timeout: 5000 });
  const w = await p.evaluate(async (o) => (await fetch(`/api/studio/works/${o}`)).json(), obra);
  const novo = w.itens.find((i) => i.titulo === 'Regra dos Nomes');
  const ideias = w.itens.find((i) => i.doc_tipo === 'ideias');
  assert.equal(novo.pai, ideias.id, 'criado na pasta Ideias');
  assert.deepEqual(a.erros, []);
  await a.ctx.close();
});

test('painel de conexoes: backlinks, links da nota, link quebrado e criar destino', async () => {
  const a = await E2E.novoAutor();
  await preparar(a, [
    { pasta: 'personagens', tipo: 'personagem', titulo: 'Kayla', corpo: 'Quinze anos.' },
    { pasta: 'manuscrito', tipo: 'capitulo', titulo: 'Capítulo 03', corpo: 'Quando [[Kayla]] chegou, leu a [[Lei do Rio]].' },
    { pasta: 'mundo', tipo: 'lugar', titulo: 'Casa', corpo: 'Onde mora [[Kayla]].' },
  ]);
  const p = a.pagina;
  await abrir(p, 'Kayla');
  await p.waitForSelector('.st-contexto .st-lista-links li');
  const mencoes = await p.locator('.st-contexto .st-lista-links').first().locator('li .st-lk span:first-child').allInnerTexts();
  assert.deepEqual(mencoes, ['Capítulo 03', 'Casa'], 'mencionada em (ordenado)');
  assert.match(await p.innerText('.st-contexto'), /Escreva \[\[ para linkar/, 'sem links de saida: dica');
  // abrir a partir do backlink
  await p.click('.st-contexto .st-lk:has-text("Capítulo 03")');
  await p.waitForFunction(() => document.querySelector('.st-titulo')?.value === 'Capítulo 03');
  await p.waitForSelector('.st-contexto .st-lk.quebrado');
  assert.equal(await p.locator('.st-pm .st-wikilink.quebrado').innerText(), 'Lei do Rio', 'link sem destino marcado no texto');
  assert.equal(await p.locator('.st-pm .st-wikilink.ok').innerText(), 'Kayla');
  const saem = await p.locator('.st-contexto .st-lista-links').last().locator('li').allInnerTexts();
  assert.equal(saem.length, 2);
  // criar o destino pelo painel conserta o link
  await p.click('.st-contexto button:has-text("criar")');
  await p.waitForFunction(() => !document.querySelector('.st-wikilink.quebrado') && !document.querySelector('.st-lk.quebrado'), null, { timeout: 8000 });
  assert.deepEqual(a.erros, []);
  await a.ctx.close();
});

test('clicar no link abre o documento; link sem destino oferece criar', async () => {
  const a = await E2E.novoAutor();
  await preparar(a, [
    { pasta: 'personagens', tipo: 'personagem', titulo: 'Max', corpo: 'Amigo.' },
    { pasta: 'manuscrito', tipo: 'capitulo', titulo: 'Cap', corpo: 'Falei com [[Max]] e com [[Fantasma]].' },
  ]);
  const p = a.pagina;
  await abrir(p, 'Cap');
  await p.waitForSelector('.st-pm .st-wikilink');
  await p.click('.st-pm .st-wikilink.ok');
  await p.waitForFunction(() => document.querySelector('.st-titulo')?.value === 'Max');
  await abrir(p, 'Cap');
  await p.click('.st-pm .st-wikilink.quebrado');
  await p.waitForSelector('dialog:has-text("ainda não existe")');
  await p.click('dialog button:has-text("Criar e abrir")');
  await p.waitForFunction(() => document.querySelector('.st-titulo')?.value === 'Fantasma');
  await a.ctx.close();
});

test('o painel de conexoes acompanha a edicao: o backlink some quando o link e apagado do texto', async () => {
  const a = await E2E.novoAutor();
  await preparar(a, [
    { pasta: 'personagens', tipo: 'personagem', titulo: 'Kayla', corpo: '' },
    { pasta: 'manuscrito', tipo: 'capitulo', titulo: 'Cap', corpo: 'Ver [[Kayla]].' },
  ]);
  const p = a.pagina;
  await abrir(p, 'Kayla');
  await p.waitForSelector('.st-contexto .st-lk:has-text("Cap")');
  await abrir(p, 'Cap');
  await p.click('.st-pm .ProseMirror');
  await p.keyboard.press('Control+A'); await p.keyboard.type('Sem link algum.');
  await salvo(p);
  await abrir(p, 'Kayla');
  await p.waitForSelector('.st-contexto .hint:has-text("Nenhuma menção")', { timeout: 8000 });
  await a.ctx.close();
});
