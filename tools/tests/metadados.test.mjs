import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeApp } from './helpers.mjs';

// serve os HTML reais de public/, como o Cloudflare faz
const ASSETS = { fetch: async (req) => {
  const p = (new URL(req.url).pathname.replace(/^\//, '') || 'index').replace(/(\.html)?$/, '.html');
  try { return new Response(readFileSync(new URL(`../../public/${p}`, import.meta.url)), { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': '1' } }); }
  catch { return new Response('nao achei', { status: 404 }); }
} };
const pagina = async (app, caminho) => {
  const r = await app.worker.fetch(new Request('https://entrelinhasbr.com.br' + caminho), app.env);
  return { r, html: await r.text() };
};
const meta = (html, prop) => (html.match(new RegExp(`<meta (?:property|name)="${prop}" content="([^"]*)"`)) || [])[1];

async function cenario() {
  const app = makeApp({ ASSETS, ESTUDIO_PUBLICACAO: 'on' });
  const a = app.addUser({ nome: 'Ana Autora' });
  app.db.prepare('INSERT INTO images (id, user_id, mime, data, created_at) VALUES (?, ?, ?, ?, ?)').run('abcdefabcdefabcdefabcdef', a.id, 'image/jpeg', new Uint8Array([1]), 1);
  const obras = [
    { titulo: 'O Rio <Fundo>', genero: 'Fantasia', status: 'Publicado', sinopse: 'Uma menina   que lembra de tudo "segue" o rio.', capa: 'abcdefabcdefabcdefabcdef', lojas: [] },
    { titulo: 'Rascunho', status: 'Em escrita', sinopse: 'Ainda não.', lojas: [] },
  ];
  const r = await app.call('PUT', '/api/profile', { tok: a.tok, body: { data: { nome: 'Ana Autora', frase: 'Escrevo rios.', links: [], secoes: [], obras } } });
  assert.equal(r.s, 200, JSON.stringify(r.j));
  return { app, a, ids: r.j.data.obras.map((o) => o.id) };
}

test('metadados: pagina do livro sai com titulo, sinopse e capa para a previa do link', async () => {
  const { app, a, ids } = await cenario();
  const { r, html } = await pagina(app, `/obra.html?a=${a.slug}&o=${ids[0]}`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('Content-Length'), null, 'tamanho antigo nao pode ir junto');
  assert.match(html, /<title>O Rio &lt;Fundo&gt; · Ana Autora \| Entrelinhas<\/title>/);
  assert.equal(meta(html, 'og:title'), 'O Rio &lt;Fundo&gt; · Ana Autora');
  assert.equal(meta(html, 'description'), 'Uma menina que lembra de tudo &quot;segue&quot; o rio.');
  assert.equal(meta(html, 'og:image'), 'https://entrelinhasbr.com.br/img/abcdefabcdefabcdefabcdef?v=2');
  assert.equal(meta(html, 'og:type'), 'book');
  assert.equal((html.match(/name="description"/g) || []).length, 1, 'sem descricao duplicada');
});

test('metadados: perfil do autor; livro nao publicado, autor inexistente e parametro estranho ficam como estao', async () => {
  const { app, a, ids } = await cenario();
  const autor = await pagina(app, `/autor?a=${a.slug}`);
  assert.equal(meta(autor.html, 'og:title'), 'Ana Autora');
  assert.equal(meta(autor.html, 'description'), 'Escrevo rios.');
  assert.equal(meta(autor.html, 'og:type'), 'profile');
  assert.match(autor.html, /noindex,nofollow/, 'o noindex continua onde ja estava');

  const original = readFileSync(new URL('../../public/obra.html', import.meta.url), 'utf8');
  const tituloOriginal = original.match(/<title>[^<]*<\/title>/)[0];
  for (const q of [`a=${a.slug}&o=${ids[1]}`, `a=ninguem&o=${ids[0]}`, `a=${a.slug}&o=<script>`, '']) {
    const { r, html } = await pagina(app, `/obra.html?${q}`);
    assert.ok(html.includes(tituloOriginal), `${q}: titulo de sempre`);
    assert.equal(meta(html, 'og:title'), undefined, `${q}: sem previa inventada`);
    assert.equal(meta(html, 'robots'), 'noindex,nofollow', q);
    assert.equal(r.headers.get('X-Robots-Tag'), 'noindex,nofollow', q);
    assert.ok(!html.includes('rel="canonical"') && !html.includes('ld+json'), `${q}: sem canonico nem JSON-LD`);
  }
});

const ldDe = (html) => JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);

test('lancamento: com PUBLIC_LAUNCH off tudo e noindex; com on so as paginas publicas indexam', async () => {
  const { app, a, ids } = await cenario();
  const publicas = ['/', '/index.html', '/autores', `/autor?a=${a.slug}`, `/obra?a=${a.slug}&o=${ids[0]}`, '/sobre', '/termos.html', '/privacidade', '/diretrizes'];
  const privadas = ['/conta.html', '/estudio', '/lixeira.html', '/chat.html', '/recuperar.html', '/redefinir.html', '/confirmar-email.html', '/ajuda.html', '/leitores.html', '/leitor.html?u=x'];
  for (const c of [...publicas, ...privadas]) assert.equal(meta((await pagina(app, c)).html, 'robots'), 'noindex,nofollow', `beta: ${c}`);

  app.env.PUBLIC_LAUNCH = 'on';
  for (const c of publicas) {
    const { r, html } = await pagina(app, c);
    assert.equal(meta(html, 'robots'), 'index,follow', c);
    assert.equal(r.headers.get('X-Robots-Tag'), 'index,follow', c);
    assert.equal((html.match(/name="robots"/g) || []).length, 1, `${c}: um robots so`);
  }
  for (const c of privadas) assert.equal(meta((await pagina(app, c)).html, 'robots'), 'noindex,nofollow', `sempre privada: ${c}`);
  assert.equal(meta((await pagina(app, `/obra?a=${a.slug}&o=${ids[1]}`)).html, 'robots'), 'noindex,nofollow', 'livro nao publicado nunca indexa');
});

test('canonico sem .html e so com os parametros da pagina; JSON-LD com dados reais e sem inventar', async () => {
  const { app, a, ids } = await cenario();
  const can = (html) => (html.match(/<link rel="canonical" href="([^"]*)">/) || [])[1];
  assert.equal(can((await pagina(app, '/index.html')).html), 'https://entrelinhasbr.com.br/');
  assert.equal(can((await pagina(app, '/termos.html?utm=x')).html), 'https://entrelinhasbr.com.br/termos');
  const autor = await pagina(app, `/autor.html?a=${a.slug}&ref=zap`);
  assert.equal(can(autor.html), `https://entrelinhasbr.com.br/autor?a=${a.slug}`);
  assert.equal(meta(autor.html, 'og:url'), `https://entrelinhasbr.com.br/autor?a=${a.slug}`);

  const org = ldDe((await pagina(app, '/')).html);
  assert.equal(org['@type'], 'Organization'); assert.equal(org.email, 'contato@entrelinhasbr.com.br');
  const pessoa = ldDe(autor.html);
  assert.deepEqual([pessoa['@type'], pessoa.name, pessoa.description], ['Person', 'Ana Autora', 'Escrevo rios.']);
  assert.equal(pessoa.image, undefined, 'sem foto, sem imagem');

  const livro = await pagina(app, `/obra?a=${a.slug}&o=${ids[0]}`);
  const b = ldDe(livro.html);
  assert.equal(b['@type'], 'Book'); assert.equal(b.name, 'O Rio <Fundo>'); assert.equal(b.genre, 'Fantasia');
  assert.equal(b.author.name, 'Ana Autora');
  assert.equal(b.image, 'https://entrelinhasbr.com.br/img/abcdefabcdefabcdefabcdef?v=2');
  for (const inventado of ['isbn', 'offers', 'publisher', 'aggregateRating', 'datePublished']) assert.equal(b[inventado], undefined, inventado);
  assert.ok(!livro.html.includes('O Rio <Fundo>'), 'o "<" do titulo nao abre tag dentro do JSON-LD');
});

test('robots.txt e sitemap.xml: sitemap so com o que e publico; robots so anuncia o sitemap depois do lancamento', async () => {
  const { app, a, ids } = await cenario();
  const outro = app.addUser({ nome: 'Sem Perfil' });
  app.db.prepare('UPDATE profiles SET published = 0 WHERE user_id = ?').run(outro.id);
  let robots = await (await pagina(app, '/robots.txt')).html;
  assert.match(robots, /Disallow: \/api\//); assert.ok(!robots.includes('Sitemap:'), 'beta: sem sitemap no robots');
  app.env.PUBLIC_LAUNCH = 'on';
  robots = (await pagina(app, '/robots.txt')).html;
  assert.match(robots, /Sitemap: https:\/\/entrelinhasbr\.com\.br\/sitemap\.xml/);

  const { r, html: xml } = await pagina(app, '/sitemap.xml');
  assert.match(r.headers.get('Content-Type'), /application\/xml/);
  const locs = [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1].replace(/&amp;/g, '&'));
  for (const p of ['', 'autores', 'sobre', 'termos', 'privacidade', 'diretrizes']) assert.ok(locs.includes(`https://entrelinhasbr.com.br/${p}`), p);
  assert.ok(locs.includes(`https://entrelinhasbr.com.br/autor?a=${a.slug}`));
  assert.ok(locs.includes(`https://entrelinhasbr.com.br/obra?a=${a.slug}&o=${ids[0]}`));
  assert.ok(!locs.some((l) => l.includes(ids[1])), 'livro em escrita fica fora');
  assert.ok(!locs.some((l) => l.includes(outro.slug)), 'perfil nao publicado fica fora');
  assert.ok(!locs.some((l) => /conta|estudio|lixeira|recuperar|redefinir|chat|api/.test(l)), 'nada privado');
});
