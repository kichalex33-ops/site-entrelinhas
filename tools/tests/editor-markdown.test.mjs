import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkdown, serializeMarkdown, statsOf, urlSegura } from '../editor/entry.mjs';

const ida = (md) => serializeMarkdown(parseMarkdown(md));

test('texto simples e acentuacao sobrevivem a ida e volta', () => {
  const md = 'Kayla olhou o rio. “Não esqueça”, disse Márcia — e foi embora.\n\nSegundo parágrafo com ção, ñ, ¿qué? e emoji 🌊.';
  assert.equal(ida(md), md);
});

test('formatacao basica: titulos, negrito, italico, listas, citacao, separador, link', () => {
  const md = [
    '# Capítulo 1', '', '## Cena', '',
    'Texto com **negrito**, *itálico* e [um link](https://exemplo.com).', '',
    '* item um', '* item dois', '', '1. primeiro', '2. segundo', '',
    '> uma citação', '', '***', '', 'fim',
  ].join('\n');
  const out = ida(md);
  for (const trecho of ['# Capítulo 1', '## Cena', '**negrito**', '*itálico*', '[um link](https://exemplo.com)', '* item um', '1. primeiro', '> uma citação', 'fim']) {
    assert.ok(out.includes(trecho), `faltou: ${trecho}\n---\n${out}`);
  }
  assert.ok(/^(\*\*\*|---)$/m.test(out), 'separador preservado');
});

test('a normalizacao e estavel: salvar, reabrir e salvar de novo nao muda o texto', () => {
  const sujo = '# Título\nlinha colada\n* a\n* b\n\n\n\n**negrito**texto  \nquebra forçada\n\n+ outra lista\n';
  const um = ida(sujo);
  assert.equal(ida(um), um);
});

test('texto longo (muitos capitulos) converte rapido e sem perdas', () => {
  const paragrafo = 'Era uma vez um rio que lembrava de tudo, mas nunca contou. ';
  const md = Array.from({ length: 4000 }, (_, i) => `${paragrafo.repeat(3)}(${i})`).join('\n\n');
  const t = Date.now();
  const out = ida(md);
  assert.equal(out, md);
  assert.ok(Date.now() - t < 3000, 'abaixo de 3 s para ~700 mil caracteres');
});

test('HTML cru no texto nao vira HTML (seguranca)', () => {
  const doc = parseMarkdown('Olá <script>alert(1)</script> <img src=x onerror=alert(1)>');
  const tipos = new Set(); doc.descendants((n) => tipos.add(n.type.name));
  assert.ok(!tipos.has('html_block') && !tipos.has('html_inline'));
  assert.ok(!tipos.has('image'), 'tag <img> escrita a mao e so texto');
  assert.ok(serializeMarkdown(doc).includes('<script>'), 'o texto permanece como texto');
});

test('contagem de palavras e caracteres', () => {
  const s = statsOf(parseMarkdown('Um dois três.\n\nQuatro cinco-seis d’água'));
  assert.equal(s.palavras, 6);
  assert.ok(s.caracteres > 20);
  assert.deepEqual(statsOf(parseMarkdown('')), { palavras: 0, caracteres: 0 });
});

test('links: so http(s) e mailto', () => {
  assert.ok(urlSegura('https://x.com') && urlSegura('http://x.com') && urlSegura('mailto:a@b.com'));
  for (const ruim of ['javascript:alert(1)', 'data:text/html,x', 'vbscript:x', '//evil.com', 'ftp://x', '']) assert.equal(urlSegura(ruim), false, ruim);
});
