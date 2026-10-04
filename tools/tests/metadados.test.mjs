import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeApp } from './helpers.mjs';

// serve os HTML reais de public/, como o Cloudflare faz
const ASSETS = { fetch: async (req) => {
  const p = new URL(req.url).pathname.replace(/^\//, '').replace(/(\.html)?$/, '.html');
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
  for (const q of [`a=${a.slug}&o=${ids[1]}`, `a=ninguem&o=${ids[0]}`, `a=${a.slug}&o=<script>`, '']) {
    assert.equal((await pagina(app, `/obra.html?${q}`)).html, original, q);
  }
  const home = await pagina(app, '/index.html');
  assert.equal(home.html, readFileSync(new URL('../../public/index.html', import.meta.url), 'utf8'), 'outras paginas nao mudam');
});
