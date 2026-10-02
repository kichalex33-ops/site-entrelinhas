import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { iniciar } from './helpers.mjs';

let E2E;
before(async () => { E2E = await iniciar(); });
after(async () => { await E2E.parar(); });

const salvo = (p) => p.waitForFunction(() => document.querySelector('.st-estado')?.dataset.estado === 'salvo', null, { timeout: 15000 });

async function obraComDocs(a, docs) {
  const p = a.pagina;
  await p.goto(`${E2E.url}/estudio.html`);
  await p.click('#st-nova'); await p.click('.st-opcao:has-text("Escrever no Entrelinhas")');
  await p.fill('dialog input', 'Obra de teste'); await p.click('dialog button:has-text("Criar obra")');
  await p.waitForSelector('.st-explorador .st-nome');
  const url = p.url();
  const obra = url.match(/obra\/([a-f0-9]{12})/)[1];
  // cria documentos pela API (rapido) e recarrega
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

test('Ctrl+K: busca sem acento e sem caixa, mostra trecho e abre o documento', async () => {
  const a = await E2E.novoAutor();
  await obraComDocs(a, [
    { pasta: 'personagens', tipo: 'personagem', titulo: 'Márcia', corpo: 'A tia de Kayla guardava um segredo.' },
    { pasta: 'manuscrito', tipo: 'capitulo', titulo: 'Capítulo 01', corpo: 'Kayla caminhou até a represa. Nada de MÁRCIA por perto.' },
    { pasta: 'ideias', tipo: 'nota', titulo: 'Solta', corpo: 'sem relação' },
  ]);
  const p = a.pagina;
  await p.keyboard.press('Control+K');
  await p.waitForSelector('dialog.st-paleta input');
  await p.keyboard.type('marcia', { delay: 20 });
  await p.waitForSelector('.st-pal-item');
  const itens = await p.locator('.st-pal-item .st-pal-rotulo').allInnerTexts();
  assert.deepEqual(itens, ['Márcia', 'Capítulo 01'], 'titulo primeiro, depois texto');
  assert.match(await p.innerText('.st-pal-trecho'), /MÁRCIA/);
  assert.equal(await p.locator('.st-pal-trecho mark').first().innerText(), 'MÁRCIA', 'trecho destacado com o texto original');
  await p.keyboard.press('ArrowDown');
  await p.keyboard.press('Enter');
  await p.waitForSelector('.st-pm .ProseMirror p');
  assert.equal(await p.inputValue('.st-titulo'), 'Capítulo 01');
  assert.match(await p.innerText('.st-pm .ProseMirror'), /represa/);
  assert.deepEqual(a.erros, []);
  await a.ctx.close();
});

test('busca: filtros por tipo, mensagem para busca curta e Esc fecha', async () => {
  const a = await E2E.novoAutor();
  await obraComDocs(a, [
    { pasta: 'manuscrito', tipo: 'capitulo', titulo: 'Cap A', corpo: 'o rio corria' },
    { pasta: 'pesquisa', tipo: 'pesquisa', titulo: 'Rios do sul', corpo: 'rio grande' },
  ]);
  const p = a.pagina;
  await p.keyboard.press('Control+K');
  await p.keyboard.type('r');
  await p.waitForSelector('.st-pal-vazio:has-text("ao menos 2 letras")');
  await p.keyboard.type('io', { delay: 20 });
  await p.waitForFunction(() => document.querySelectorAll('.st-pal-item').length === 2);
  await p.selectOption('select[aria-label="Filtrar por tipo"]', 'pesquisa');
  await p.waitForFunction(() => document.querySelectorAll('.st-pal-item').length === 1);
  assert.equal(await p.locator('.st-pal-rotulo').innerText(), 'Rios do sul');
  await p.keyboard.press('Escape');
  await p.waitForSelector('dialog.st-paleta', { state: 'detached', timeout: 3000 });
  await a.ctx.close();
});

test('Ctrl+P: paleta cria capitulo, abre documento por nome e executa comandos', async () => {
  const a = await E2E.novoAutor();
  await obraComDocs(a, [{ pasta: 'personagens', tipo: 'personagem', titulo: 'Kayla', corpo: 'quinze anos' }]);
  const p = a.pagina;
  await p.keyboard.press('Control+P');
  await p.waitForSelector('dialog.st-paleta input');
  assert.ok((await p.locator('.st-pal-item').count()) >= 8, 'lista os comandos antes de digitar');
  await p.keyboard.type('criar cap', { delay: 20 });
  assert.equal(await p.locator('.st-pal-item .st-pal-rotulo').first().innerText(), 'Criar capítulo', 'fuzzy: o melhor resultado e o comando certo');
  await p.keyboard.press('Enter');
  await p.waitForFunction(() => document.querySelector('.st-titulo')?.value === 'Capítulo 01');
  await p.keyboard.press('Control+P');
  await p.keyboard.type('kyl', { delay: 20 }); // fuzzy: K-y-l casa com "Kayla"
  await p.waitForSelector('.st-pal-item');
  assert.equal(await p.locator('.st-pal-item .st-pal-rotulo').first().innerText(), 'Kayla');
  await p.keyboard.press('Enter');
  await p.waitForFunction(() => document.querySelector('.st-titulo')?.value === 'Kayla');
  await p.keyboard.press('Control+P');
  await p.keyboard.type('foco', { delay: 20 });
  await p.keyboard.press('Enter');
  await p.waitForFunction(() => document.body.classList.contains('st-foco'));
  await p.keyboard.press('Escape');
  assert.deepEqual(a.erros, []);
  await a.ctx.close();
});

test('tags: adicionar e remover no contexto, hashtag no texto, filtro no explorador', async () => {
  const a = await E2E.novoAutor();
  const { ids } = await obraComDocs(a, [
    { pasta: 'manuscrito', tipo: 'capitulo', titulo: 'Cap 1', corpo: 'texto simples' },
    { pasta: 'manuscrito', tipo: 'capitulo', titulo: 'Cap 2', corpo: 'outro texto' },
  ]);
  const p = a.pagina;
  await p.click('.st-nome:has-text("Cap 1")');
  await p.waitForSelector('.st-pm .ProseMirror p');
  await p.fill('.st-tag-campo', '#Resolver');
  await p.keyboard.press('Enter');
  await p.waitForSelector('.st-chip:has-text("#resolver")');
  // hashtag escrita no texto vira tag depois do autosave
  await p.click('.st-pm .ProseMirror');
  await p.keyboard.press('Control+End');
  await p.keyboard.type(' Precisa #revisar depois.');
  await salvo(p);
  await p.waitForSelector('.st-chip:has-text("#revisar")');
  assert.equal(await p.locator('.st-chip:has-text("#revisar") .st-chip-x').count(), 0, 'tag do texto nao tem o botao de remover');
  assert.ok(await p.locator('.st-chip:has-text("#resolver") .st-chip-x').count(), 'tag manual tem');
  // filtro no explorador
  await p.selectOption('.st-filtro select', 'resolver');
  assert.deepEqual(await p.locator('.st-arvore .st-nome .st-rotulo').allInnerTexts(), ['Manuscrito', 'Cap 1'], 'so a pasta e o documento com a tag');
  await p.selectOption('.st-filtro select', '');
  assert.ok((await p.locator('.st-arvore .st-nome').count()) >= 8);
  // remover a tag manual
  await p.click('.st-chip:has-text("#resolver") .st-chip-x');
  await p.waitForFunction(() => !document.querySelector('.st-chip-nome')?.textContent.includes('resolver') || document.querySelectorAll('.st-chip').length === 1);
  assert.equal(await p.locator('.st-chip:has-text("#resolver")').count(), 0);
  // persistiu no servidor
  const w = await p.evaluate(async (obra) => (await fetch(`/api/studio/works/${obra}`)).json(), (await p.url()).match(/obra\/([a-f0-9]{12})/)[1]);
  assert.deepEqual(w.itens.find((i) => i.id === ids[0]).tags, ['revisar']);
  assert.deepEqual(a.erros, []);
  await a.ctx.close();
});

test('atalhos do Estudio nao disparam fora dele', async () => {
  const a = await E2E.novoAutor();
  await a.pagina.goto(`${E2E.url}/estudio.html`);
  await a.pagina.waitForSelector('#st-nova');
  await a.pagina.keyboard.press('Control+K');
  assert.equal(await a.pagina.locator('dialog.st-paleta').count(), 0, 'na lista de obras Ctrl+K nao abre a busca');
  await a.ctx.close();
});
