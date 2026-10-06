// Paginas institucionais (Termos, Privacidade, Diretrizes, Sobre): existem, tem o contato e estao no rodape de todo o site.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const pub = new URL('../../public/', import.meta.url);
const ler = (f) => readFileSync(new URL(f, pub), 'utf8');
const PAGINAS = ['termos.html', 'privacidade.html', 'diretrizes.html', 'sobre.html'];

test('paginas institucionais: titulo proprio, contato oficial e links entre si', () => {
  for (const f of PAGINAS) {
    const h = ler(f);
    assert.match(h, /<title>[^<]+ \| Entrelinhas<\/title>/, f);
    assert.match(h, /<meta name="description" content="[^"]{40,}">/, f);
    assert.ok(h.includes('contato@entrelinhasbr.com.br'), `${f}: contato`);
    assert.ok(!/COLE_AQUI|TODO|FIXME|[Ll]orem ipsum/.test(h), `${f}: sem texto provisorio`);
  }
  assert.match(ler('termos.html'), /não transfere ao coletivo a propriedade da obra/);
  assert.match(ler('privacidade.html'), /hash PBKDF2/);
  assert.match(ler('diretrizes.html'), /Não proibimos o uso de IA/);
});

test('rodape de todas as paginas leva a Sobre, Termos, Privacidade, Diretrizes e Contato', () => {
  const comRodape = readdirSync(pub).filter((f) => f.endsWith('.html') && ler(f).includes('class="site-footer"'));
  assert.ok(comRodape.length >= 15, 'paginas com rodape');
  for (const f of comRodape) {
    const h = ler(f);
    for (const alvo of ['sobre.html', 'termos.html', 'privacidade.html', 'diretrizes.html', 'mailto:contato@entrelinhasbr.com.br']) {
      assert.ok(h.includes(`href="${alvo}"`), `${f} sem link para ${alvo}`);
    }
  }
});
