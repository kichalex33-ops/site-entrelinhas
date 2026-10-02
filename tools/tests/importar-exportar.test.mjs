import { test } from 'node:test';
import assert from 'node:assert/strict';
import mammoth from 'mammoth';
import { textoParaMarkdown, normalizarMarkdown, decodificarTexto, dividirCapitulos, sugerirModo } from '../editor/importar.mjs';
import { limparParaManuscrito, montarMarkdown, montarTxt, gerarDocx, nomeArquivoSeguro } from '../editor/exportar.mjs';

// ---------------------------------------------------------------- importacao: texto
test('txt com linhas em branco: junta linhas quebradas a mao em paragrafos', () => {
  const md = textoParaMarkdown('Primeira linha do\nparagrafo um.\n\nSegundo paragrafo.\r\n\r\n***\r\n\r\nTerceiro.');
  assert.equal(md, 'Primeira linha do paragrafo um.\n\nSegundo paragrafo.\n\n---\n\nTerceiro.');
});

test('txt sem linhas em branco: cada linha e um paragrafo; caracteres de Markdown sao escapados', () => {
  const md = textoParaMarkdown('# nao e titulo\n* nem lista\nlinha 3');
  assert.ok(md.startsWith('\\# nao e titulo'), md);
  assert.ok(!/^#\s/m.test(md) && !/^\*\s/m.test(md), 'nenhuma estrutura Markdown criada sem querer');
  assert.equal(md.split('\n\n').length, 3);
});

test('txt: acentuacao preservada e separador de cena reconhecido', () => {
  assert.equal(textoParaMarkdown('Ação, coração, “aspas”.\n\n* * *\n\nFim.'), 'Ação, coração, “aspas”.\n\n---\n\nFim.');
});

test('decodificarTexto: UTF-8, UTF-8 com BOM e Windows-1252', () => {
  assert.equal(decodificarTexto(new TextEncoder().encode('coração')), 'coração');
  assert.equal(decodificarTexto(new Uint8Array([0xef, 0xbb, 0xbf, 0x61])).replace(/^﻿/, ''), 'a');
  assert.equal(decodificarTexto(new Uint8Array([0x63, 0x6f, 0x72, 0x61, 0xe7, 0xe3, 0x6f])), 'coração', 'bytes do Word antigo (Windows-1252)');
});

test('markdown importado e normalizado e fica estavel', () => {
  const um = normalizarMarkdown('Titulo\n=====\n\ntexto  \ncom quebra\n\n* a\n* b\n');
  assert.equal(normalizarMarkdown(um), um);
  assert.ok(um.startsWith('# Titulo'));
});

// ---------------------------------------------------------------- capitulos
const livro = (n, prefixo = '# ') => Array.from({ length: n }, (_, i) => `${prefixo}Capítulo ${i + 1}\n\nTexto do capítulo ${i + 1}, com algumas palavras para contar.`).join('\n\n');

test('sugerirModo escolhe o mais forte: H1, "Capitulo N" em paragrafo, H2 ou nenhum', () => {
  assert.equal(sugerirModo(livro(3, '# ')), 'h1');
  assert.equal(sugerirModo(livro(3, '')), 'padrao', 'paragrafos "Capítulo N" (o que o Word entrega)');
  assert.equal(sugerirModo('# Título do livro\n\n## Um\n\ntexto\n\n## Dois\n\ntexto'), 'h2');
  assert.equal(sugerirModo('So um texto corrido sem divisao nenhuma.'), 'nenhum');
  assert.equal(sugerirModo('# Único título\n\ntexto'), 'nenhum');
});

test('dividir por H1: titulos viram nomes, corpo sem o titulo, texto antes vira "Abertura"', () => {
  const md = 'Dedicado a quem lê.\n\n' + livro(3);
  const c = dividirCapitulos(md, 'h1');
  assert.deepEqual(c.map((x) => x.titulo), ['Abertura', 'Capítulo 1', 'Capítulo 2', 'Capítulo 3']);
  assert.ok(!c[1].corpo.includes('# '), 'o titulo nao fica no corpo');
  assert.match(c[2].corpo, /^Texto do capítulo 2/);
  assert.ok(c[1].palavras >= 9);
});

test('dividir por padrao: Capitulo N, numerais romanos, prologo/epilogo e Parte', () => {
  const md = ['Prólogo', 'Era uma vez.', 'CAPÍTULO I', 'Um.', '**Capítulo 2: O rio**', 'Dois.', 'Cap. 3', 'Três.', 'Epílogo.', 'Fim.', 'Parte Dois — A volta', 'Volta.'].join('\n\n');
  const c = dividirCapitulos(md, 'padrao');
  assert.deepEqual(c.map((x) => x.titulo), ['Prólogo', 'CAPÍTULO I', 'Capítulo 2: O rio', 'Cap. 3', 'Epílogo', 'Parte Dois — A volta']);
  assert.equal(c[0].corpo, 'Era uma vez.');
});

test('dividir por padrao nao quebra frases comuns que citam "capitulo"', () => {
  const md = 'Capítulo 1\n\nNo capítulo anterior, ela partiu. O capítulo seguinte é mais longo, e muito mais cheio de eventos do que se esperava ler.\n\nCapítulo 2\n\nFim.';
  const c = dividirCapitulos(md, 'padrao');
  assert.equal(c.length, 2);
  assert.match(c[0].corpo, /No capítulo anterior/);
});

test('titulos dentro de blocos de codigo e linhas coladas ao texto nao sao capitulos', () => {
  const md = '# Real\n\ntexto\n\n```\n# falso\n```\n\n# Outro\n\ntexto';
  assert.deepEqual(dividirCapitulos(md, 'h1').map((x) => x.titulo), ['Real', 'Outro']);
  const colado = 'Capítulo 1\nlinha colada logo abaixo\n\nCapítulo 2\n\nfim';
  assert.equal(dividirCapitulos(colado, 'padrao').length, 2);
});

test('modo "nenhum" e texto sem titulos geram um unico documento', () => {
  assert.equal(dividirCapitulos(livro(3), 'nenhum', 'Meu livro').length, 1);
  assert.equal(dividirCapitulos(livro(3), 'nenhum', 'Meu livro')[0].titulo, 'Meu livro');
  assert.equal(dividirCapitulos('texto simples', 'h1', 'X')[0].titulo, 'X');
});

test('manuscrito grande: 120 capitulos divididos rapido e sem perda de texto', () => {
  const md = livro(120, '# ').replace(/Texto do capítulo/g, 'Texto longo do capítulo '.repeat(40) + 'n.º');
  const t = Date.now();
  const c = dividirCapitulos(md, 'h1');
  assert.equal(c.length, 120);
  assert.ok(Date.now() - t < 1500);
  const total = c.reduce((s, x) => s + x.corpo.length, 0);
  assert.ok(total > md.length * 0.9, 'o corpo preserva o texto (so os titulos saem)');
});

// ---------------------------------------------------------------- exportacao
test('limparParaManuscrito: [[links]] viram texto e #hashtags somem (privado nao vaza)', () => {
  const sujo = 'Kayla viu [[Max]] e [[Casa de Kayla|a casa]] #resolver na margem.\n\n#revisar linha so de tag\n\n\\[\\[Escapado\\]\\] e (#nota) no fim #continuidade';
  const limpo = limparParaManuscrito(sujo);
  assert.ok(!/\[\[|\]\]|#resolver|#revisar|#nota|#continuidade/.test(limpo), limpo);
  assert.ok(limpo.includes('Kayla viu Max e a casa na margem.'), limpo);
  assert.ok(limpo.includes('Escapado'));
});

test('limparParaManuscrito nao mexe em titulos Markdown, links comuns nem em "n.º 1"', () => {
  const md = '# Título\n\n[site](https://x.com) e o item #1 e a rua n.º 5';
  assert.equal(limparParaManuscrito(md), md);
});

test('montarMarkdown e montarTxt: ordem dos capitulos, titulo e sem conteudo privado', () => {
  const caps = [{ titulo: 'Um', corpo: 'Texto com [[Max]] #tag **forte**.' }, { titulo: 'Dois', corpo: '* * *\n\nOutro.' }];
  const md = montarMarkdown(caps, { titulo: 'Meu Livro', autor: 'Alex' });
  assert.ok(md.startsWith('# Meu Livro\n\n*Alex*\n\n## Um\n\nTexto com Max'), md);
  assert.ok(md.indexOf('## Um') < md.indexOf('## Dois'));
  assert.ok(!md.includes('[[') && !md.includes('#tag'));
  const txt = montarTxt(caps, { titulo: 'Meu Livro', autor: 'Alex' });
  assert.ok(txt.startsWith('MEU LIVRO\nAlex'), txt);
  assert.ok(txt.includes('UM\n\nTexto com Max .') || txt.includes('UM\n\nTexto com Max forte.'), txt);
  assert.ok(!txt.includes('**') && !txt.includes('[['));
  assert.ok(txt.includes('* * *'), 'separador de cena preservado');
});

test('DOCX gerado: abre, tem titulo, capitulos em ordem e nenhum conteudo privado', async () => {
  const caps = [
    { titulo: 'Capítulo 1', corpo: 'Kayla desceu até o rio com **muito cuidado**.\n\n> “O rio lembra.”\n\n* um\n* dois\n\n1. primeiro\n2. segundo\n\n***\n\nDepois falou com [[Max]] #resolver.' },
    { titulo: 'Capítulo 2', corpo: 'Segundo capítulo, com [link](https://exemplo.com) e acentuação: ação, coração.' },
  ];
  const blob = await gerarDocx(caps, { titulo: 'O Que o Rio Esqueceu', autor: 'Alex Kich' });
  const buf = Buffer.from(await blob.arrayBuffer());
  assert.equal(buf.subarray(0, 2).toString('latin1'), 'PK', 'e um zip/docx');
  const { value } = await mammoth.extractRawText({ buffer: buf });
  assert.ok(value.indexOf('O Que o Rio Esqueceu') < value.indexOf('Capítulo 1') && value.indexOf('Capítulo 1') < value.indexOf('Capítulo 2'), 'ordem');
  for (const t of ['Kayla desceu até o rio com muito cuidado.', '“O rio lembra.”', 'um', 'primeiro', '* * *', 'Depois falou com Max.', 'ação, coração', 'Alex Kich']) assert.ok(value.includes(t), `faltou "${t}" em:\n${value}`);
  assert.ok(!value.includes('[[') && !value.includes('#resolver') && !value.includes('**'), 'sem Markdown cru nem conteudo privado');
  // titulos de capitulo no DOCX como Heading 1 (navegacao do Word)
  const html = (await mammoth.convertToHtml({ buffer: buf })).value;
  assert.match(html, /<h1[^>]*>(?:<strong>)?Capítulo 1(?:<\/strong>)?<\/h1>/);
  assert.match(html, /<strong>muito cuidado<\/strong>/);
  assert.match(html, /<a href="https:\/\/exemplo\.com">link<\/a>/);
});

test('nome de arquivo seguro', () => {
  assert.equal(nomeArquivoSeguro('O Que o Rio Esqueceu: Livro I'), 'O-Que-o-Rio-Esqueceu-Livro-I');
  assert.equal(nomeArquivoSeguro('../../etc/passwd'), 'etc-passwd');
  assert.equal(nomeArquivoSeguro(''), 'manuscrito');
});

test('folha de titulo vazia nao vira capitulo e o titulo do livro e sugerido', async () => {
  const { tituloDoLivro } = await import('../editor/importar.mjs');
  const md = '# O Que o Rio Esqueceu\n\n# Capítulo 1\n\nUm.\n\n# Capítulo 2\n\nDois.';
  const c = dividirCapitulos(md, 'h1');
  assert.deepEqual(c.map((x) => x.titulo), ['Capítulo 1', 'Capítulo 2']);
  assert.equal(tituloDoLivro(md, 'h1'), 'O Que o Rio Esqueceu');
  assert.equal(tituloDoLivro('# Capítulo 1\n\nUm.\n\n# Capítulo 2\n\nDois.\n\n# Capítulo 3\n\nTrês.', 'h1'), '', 'primeiro capitulo com texto nao e folha de titulo');
  // dois capitulos so: o primeiro vazio e mantido (nao arrisca perder estrutura)
  assert.equal(dividirCapitulos('# A\n\n# B\n\ntexto', 'h1').length, 2);
});
