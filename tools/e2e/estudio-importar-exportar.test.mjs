import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import mammoth from 'mammoth';
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } from 'docx';
import { iniciar } from './helpers.mjs';

let E2E, dir;
before(async () => { E2E = await iniciar(); dir = fs.mkdtempSync(path.join(os.tmpdir(), 'estudio-')); });
after(async () => { await E2E.parar(); fs.rmSync(dir, { recursive: true, force: true }); });

const salvo = (p) => p.waitForFunction(() => document.querySelector('.st-estado')?.dataset.estado === 'salvo', null, { timeout: 15000 });
const gravar = (nome, conteudo) => { const f = path.join(dir, nome); fs.writeFileSync(f, conteudo); return f; };

// DOCX realista, como o Word entrega: capitulos em Heading 1, negrito/itálico, separador "* * *" e uma citacao
async function docxLivro() {
  const p = (...runs) => new Paragraph({ children: runs });
  const doc = new Document({ sections: [{ children: [
    new Paragraph({ text: 'O Que o Rio Esqueceu', heading: HeadingLevel.TITLE }),
    new Paragraph({ text: 'Capítulo 1', heading: HeadingLevel.HEADING_1 }),
    p(new TextRun('Kayla desceu até o rio com '), new TextRun({ text: 'muito cuidado', bold: true }), new TextRun(' e '), new TextRun({ text: 'em silêncio', italics: true }), new TextRun('.')),
    p(new TextRun('“Não esqueça”, disse Márcia.')),
    new Paragraph({ children: [new TextRun('* * *')], alignment: AlignmentType.CENTER }),
    p(new TextRun('Depois da cena, o silêncio.')),
    new Paragraph({ text: 'Capítulo 2', heading: HeadingLevel.HEADING_1 }),
    p(new TextRun('Segundo capítulo, com ação, coração e “aspas”.')),
    new Paragraph({ text: 'Capítulo 3', heading: HeadingLevel.HEADING_1 }),
    p(new TextRun('O fim do livro.')),
  ] }] });
  return Buffer.from(await Packer.toBuffer(doc));
}

async function novaObraVazia(a, titulo = 'Obra de teste') {
  const p = a.pagina;
  await p.goto(`${E2E.url}/estudio.html`);
  await p.click('#st-nova'); await p.click('.st-opcao:has-text("Escrever no Entrelinhas")');
  await p.fill('dialog input', titulo); await p.click('dialog button:has-text("Criar obra")');
  await p.waitForSelector('.st-explorador .st-nome');
  return p.url().match(/obra\/([a-f0-9]{12})/)[1];
}
const docs = (p, obra) => p.evaluate(async (o) => (await (await fetch(`/api/studio/works/${o}`)).json()).itens.filter((i) => i.tipo === 'doc'), obra);
const corpo = (p, obra, id) => p.evaluate(async ([o, d]) => (await (await fetch(`/api/studio/works/${o}/docs/${d}`)).json()).corpo, [obra, id]);

test('importar DOCX para uma nova obra: capitulos detectados, conferidos e criados no Manuscrito', async () => {
  const a = await E2E.novoAutor();
  const p = a.pagina;
  const arq = gravar('O Que o Rio Esqueceu.docx', await docxLivro());
  await p.goto(`${E2E.url}/estudio.html`);
  await p.click('#st-nova');
  await p.click('.st-opcao:has-text("Importar manuscrito")');
  await p.setInputFiles('.st-drop-input', arq);
  await p.waitForSelector('.st-imp-lista');
  assert.match(await p.innerText('.st-import [role=status]'), /3 capítulos/);
  const titulos = await p.locator('.st-imp-titulo').evaluateAll((els) => els.map((e) => e.value));
  assert.deepEqual(titulos, ['Capítulo 1', 'Capítulo 2', 'Capítulo 3'], 'a folha de titulo do Word nao virou capitulo');
  // conferencia: renomear, unir e desmarcar
  const primeiro = p.locator('.st-imp-titulo').first();
  await primeiro.fill('Um: Kayla e o rio');
  assert.equal(await p.inputValue('.st-import .fld input'), 'O Que o Rio Esqueceu', 'titulo da obra vem do arquivo');
  await p.click('#st-imp-ok');
  await p.waitForSelector('.st-import button:has-text("Abrir o manuscrito")', { timeout: 20000 });
  assert.match(await p.innerText('.st-import [role=status]'), /Pronto/);
  await p.click('.st-import button:has-text("Abrir o manuscrito")');
  await p.waitForSelector('.st-pm .ProseMirror p');
  const obra = p.url().match(/obra\/([a-f0-9]{12})/)[1];
  const lista = await docs(p, obra);
  const nomes = lista.map((d) => d.titulo);
  assert.ok(nomes.includes('Um: Kayla e o rio') && nomes.includes('Capítulo 2') && nomes.includes('Capítulo 3'), nomes.join('|'));
  const ms = await p.evaluate(async (o) => (await (await fetch(`/api/studio/works/${o}`)).json()).itens.find((i) => i.doc_tipo === 'manuscrito').id, obra);
  assert.ok(lista.every((d) => d.pai === ms && d.doc_tipo === 'capitulo'), 'tudo dentro da pasta Manuscrito como capitulo');
  const cap1 = lista.find((d) => d.titulo === 'Um: Kayla e o rio');
  const md = await corpo(p, obra, cap1.id);
  assert.ok(md.includes('**muito cuidado**') && md.includes('*em silêncio*'), 'negrito e italico mantidos: ' + md);
  assert.ok(md.includes('“Não esqueça”') && /^---$/m.test(md), 'aspas e separador de cena mantidos');
  assert.ok(!md.includes('Capítulo 1'), 'o titulo nao fica repetido dentro do texto');
  // o arquivo original ficou guardado, privado
  const arqs = await p.evaluate(async (o) => (await (await fetch(`/api/studio/works/${o}/files`)).json()).arquivos, obra);
  assert.equal(arqs.length, 1); assert.equal(arqs[0].nome, 'O Que o Rio Esqueceu.docx');
  assert.deepEqual(a.erros, []);
  await a.ctx.close();
});

test('importar TXT e Markdown dentro de uma obra existente; unir capitulos e desmarcar', async () => {
  const a = await E2E.novoAutor();
  const p = a.pagina;
  const obra = await novaObraVazia(a);
  const txt = gravar('rascunho.txt', 'Capítulo 1\n\nPrimeira linha\nquebrada a mão.\n\nSegundo parágrafo.\n\nCapítulo 2\n\nTexto dois.\n\nCapítulo 3\n\nTexto três.\n');
  await p.keyboard.press('Control+P'); await p.keyboard.type('importar'); await p.keyboard.press('Enter');
  await p.setInputFiles('.st-drop-input', txt);
  await p.waitForSelector('.st-imp-lista');
  assert.equal(await p.locator('.st-imp-cap').count(), 3);
  await p.locator('.st-imp-cap').nth(2).locator('input[type=checkbox]').uncheck();          // tira o Capitulo 3
  await p.locator('.st-imp-cap').nth(1).locator('button:has-text("Unir")').click();          // une o 2 ao 1
  assert.equal(await p.locator('.st-imp-cap').count(), 2, 'depois de unir sobram 2 linhas (a desmarcada continua na lista)');
  await p.click('#st-imp-ok');
  await p.waitForSelector('.st-import button:has-text("Abrir o manuscrito")', { timeout: 20000 });
  await p.click('.st-import button:has-text("Abrir o manuscrito")');
  await p.waitForSelector('.st-pm .ProseMirror p');
  const lista = await docs(p, obra);
  assert.deepEqual(lista.map((d) => d.titulo), ['Capítulo 1'], 'so o Capitulo 1 (com o 2 unido); o 3 foi desmarcado');
  const md = await corpo(p, obra, lista[0].id);
  assert.match(md, /Primeira linha quebrada a mão\./, 'linha quebrada a mao virou um paragrafo');
  assert.match(md, /Texto dois\./, 'texto do capitulo unido');
  assert.ok(!md.includes('Texto três'));
  // Markdown, por cima
  const mdArq = gravar('extra.md', '# Prólogo\n\nEra uma vez [[Kayla]].\n\n# Epílogo\n\nFim. #revisar');
  await p.keyboard.press('Control+P'); await p.keyboard.type('importar'); await p.keyboard.press('Enter');
  await p.setInputFiles('.st-drop-input', mdArq);
  await p.waitForSelector('.st-imp-lista');
  assert.deepEqual(await p.locator('.st-imp-titulo').evaluateAll((els) => els.map((e) => e.value)), ['Prólogo', 'Epílogo']);
  await p.click('#st-imp-ok');
  await p.waitForSelector('.st-import button:has-text("Abrir o manuscrito")', { timeout: 20000 });
  await p.click('.st-import button:has-text("Abrir o manuscrito")');
  await p.waitForFunction(() => document.querySelector('.st-titulo')?.value === 'Prólogo');
  assert.ok(await p.locator('.st-pm .st-wikilink').count(), '[[Kayla]] do Markdown virou link interno');
  assert.deepEqual((await docs(p, obra)).map((d) => d.titulo), ['Capítulo 1', 'Prólogo', 'Epílogo'], 'acrescentado no fim, na ordem');
  assert.deepEqual(a.erros, []);
  await a.ctx.close();
});

test('importacao: arquivo invalido mostra erro claro e permite tentar de novo', async () => {
  const a = await E2E.novoAutor();
  const p = a.pagina;
  await novaObraVazia(a);
  await p.keyboard.press('Control+P'); await p.keyboard.type('importar'); await p.keyboard.press('Enter');
  await p.setInputFiles('.st-drop-input', gravar('foto.png', Buffer.from([0x89, 0x50, 0x4e, 0x47])));
  await p.waitForSelector('.st-erro[role=alert]');
  assert.match(await p.innerText('.st-erro[role=alert]'), /Formato não aceito/);
  await p.setInputFiles('.st-drop-input', gravar('vazio.txt', ''));
  await p.waitForSelector('.st-erro[role=alert]:has-text("Não encontramos texto")');
  await p.setInputFiles('.st-drop-input', gravar('corrompido.docx', Buffer.from('isto nao e um docx de verdade')));
  await p.waitForFunction(() => document.querySelector('.st-erro[role=alert]')?.textContent.length > 5);
  assert.ok(await p.locator('.st-drop-input').count(), 'continua na tela de escolher arquivo');
  await p.keyboard.press('Escape');
  await a.ctx.close();
});

async function obraParaExportar(a) {
  const p = a.pagina;
  const obra = await novaObraVazia(a, 'O Que o Rio Esqueceu');
  await p.evaluate(async (obra) => {
    const H = { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' };
    const w = await (await fetch(`/api/studio/works/${obra}`)).json();
    const pasta = (t) => w.itens.find((i) => i.doc_tipo === t).id;
    const mk = async (pai, titulo, tipo, corpo) => { const c = await (await fetch(`/api/studio/works/${obra}/docs`, { method: 'POST', headers: H, body: JSON.stringify({ pai, doc_tipo: tipo, titulo }) })).json(); await fetch(`/api/studio/works/${obra}/docs/${c.id}`, { method: 'PUT', headers: H, body: JSON.stringify({ versao_base: 1, corpo }) }); return c.id; };
    await mk(pasta('manuscrito'), 'Capítulo 1', 'capitulo', 'Kayla viu [[Max]] na margem. #resolver\n\nSegundo parágrafo com **negrito**.');
    await mk(pasta('manuscrito'), 'Capítulo 2', 'capitulo', 'Texto do segundo capítulo.');
    await mk(pasta('personagens'), 'Max', 'personagem', 'FICHA PRIVADA DO MAX: segredo que nao pode vazar.');
    await mk(pasta('pesquisa'), 'Pesquisa', 'pesquisa', 'NOTA DE PESQUISA PRIVADA.');
  }, obra);
  await p.reload();
  await p.waitForSelector('.st-explorador .st-nome');
  return obra;
}
const baixar = async (p, acao) => { const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 30000 }), acao()]); const f = path.join(dir, dl.suggestedFilename()); await dl.saveAs(f); return { nome: dl.suggestedFilename(), buf: fs.readFileSync(f) }; };

test('exportar manuscrito em DOCX: capitulos em ordem, sem notas privadas, links ou tags', async () => {
  const a = await E2E.novoAutor();
  const p = a.pagina;
  await obraParaExportar(a);
  await p.click('button:has-text("Exportar")');
  await p.waitForSelector('dialog:has-text("Exportar")');
  assert.match(await p.innerText('dialog select[aria-label="O que exportar"]'), /Manuscrito: 2 documento/);
  await p.fill('dialog input[placeholder="opcional"]', 'Alex Kich');
  const arq = await baixar(p, () => p.click('dialog button:has-text("Exportar")'));
  assert.equal(arq.nome, 'O-Que-o-Rio-Esqueceu.docx');
  const { value } = await mammoth.extractRawText({ buffer: arq.buf });
  assert.ok(value.indexOf('O Que o Rio Esqueceu') < value.indexOf('Capítulo 1') && value.indexOf('Capítulo 1') < value.indexOf('Capítulo 2'), 'ordem');
  assert.ok(value.includes('Kayla viu Max na margem.') && value.includes('Segundo parágrafo com negrito.') && value.includes('Alex Kich'));
  for (const privado of ['FICHA PRIVADA', 'PESQUISA PRIVADA', '[[', '#resolver', '**']) assert.ok(!value.includes(privado), `vazou: ${privado}`);
  assert.deepEqual(a.erros, []);
  await a.ctx.close();
});

test('exportar Markdown e TXT; projeto completo inclui tudo (copia do autor)', async () => {
  const a = await E2E.novoAutor();
  const p = a.pagina;
  await obraParaExportar(a);
  await p.click('button:has-text("Exportar")');
  await p.selectOption('dialog select[aria-label="Formato"]', 'md');
  const md = await baixar(p, () => p.click('dialog button:has-text("Exportar")'));
  assert.equal(md.nome, 'O-Que-o-Rio-Esqueceu.md');
  const mdTxt = md.buf.toString('utf8');
  assert.match(mdTxt, /^# O Que o Rio Esqueceu\n\n## Capítulo 1\n\nKayla viu Max na margem\.\n\nSegundo parágrafo com \*\*negrito\*\*\./);
  assert.ok(mdTxt.indexOf('## Capítulo 1') < mdTxt.indexOf('## Capítulo 2') && !/FICHA|PESQUISA PRIVADA|\[\[|#resolver/.test(mdTxt));
  await p.selectOption('dialog select[aria-label="Formato"]', 'txt');
  const txt = await baixar(p, () => p.click('dialog button:has-text("Exportar")'));
  assert.equal(txt.nome, 'O-Que-o-Rio-Esqueceu.txt');
  assert.ok(txt.buf.toString('utf8').includes('CAPÍTULO 1\n\nKayla viu Max na margem.') && !txt.buf.toString('utf8').includes('**'));
  await p.selectOption('dialog select[aria-label="O que exportar"]', 'tudo');
  assert.equal(await p.locator('dialog select[aria-label="Formato"]').isDisabled(), true, 'projeto completo e sempre Markdown');
  const todo = await baixar(p, () => p.click('dialog button:has-text("Exportar")'));
  assert.equal(todo.nome, 'O-Que-o-Rio-Esqueceu-projeto-completo.md');
  const t = todo.buf.toString('utf8');
  assert.ok(t.includes('FICHA PRIVADA DO MAX') && t.includes('NOTA DE PESQUISA PRIVADA') && t.includes('[[Max]]') && t.includes('#resolver'), 'copia completa mantem notas, links e tags');
  assert.ok(t.includes('## Personagens') && t.includes('### Max (Personagem)'));
  await a.ctx.close();
});

test('exportar salva antes o que ainda esta pendente', async () => {
  const a = await E2E.novoAutor();
  const p = a.pagina;
  await obraParaExportar(a);
  await p.click('.st-nome:has-text("Capítulo 2")');
  await p.waitForFunction(() => document.querySelector('.st-titulo')?.value === 'Capítulo 2');
  await p.click('.st-pm .ProseMirror'); await p.keyboard.press('Control+End'); await p.keyboard.type(' ACRESCENTO-RECENTE.');
  await p.click('button:has-text("Exportar")'); // sem esperar o autosave
  await p.selectOption('dialog select[aria-label="Formato"]', 'md');
  const md = await baixar(p, () => p.click('dialog button:has-text("Exportar")'));
  assert.ok(md.buf.toString('utf8').includes('ACRESCENTO-RECENTE'), 'o texto digitado ha instantes entrou no arquivo');
  await a.ctx.close();
});
