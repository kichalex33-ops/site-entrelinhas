import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp } from './helpers.mjs';

const post = (extra = {}) => ({ tipo: 'dica', titulo: 'Corte o primeiro capítulo', texto: 'Quase sempre a história começa no segundo capítulo. Experimente.', ...extra });

test('Comunidade: autor e moderador postam; leitor e visitante nao; todos leem', async () => {
  const app = makeApp();
  const autor = app.addUser({ nome: 'Ana Autora' }), leitor = app.addUser({ role: 'leitor' }), mod = app.addUser({ mod: true, role: 'leitor', nome: 'Moderadora' });
  assert.equal((await app.call('POST', '/api/comunidade', { body: post() })).s, 401);
  assert.equal((await app.call('POST', '/api/comunidade', { tok: leitor.tok, body: post() })).s, 403);
  const a = await app.call('POST', '/api/comunidade', { tok: autor.tok, body: post() });
  assert.equal(a.s, 200, JSON.stringify(a.j));
  assert.equal((await app.call('POST', '/api/comunidade', { tok: mod.tok, body: post({ tipo: 'noticia', titulo: 'Beta aberto' }) })).s, 200);

  const pub = (await app.call('GET', '/api/comunidade')).j;
  assert.deepEqual(pub.posts.map((p) => p.titulo), ['Beta aberto', 'Corte o primeiro capítulo']);
  assert.equal(pub.eu, null);
  const pa = pub.posts[1];
  assert.deepEqual(pa.autor, { nome: 'Ana Autora', slug: autor.slug }); assert.equal(pa.meu, false);
  assert.equal(pub.posts[0].autor.slug, null, 'moderador sem perfil de autor nao vira link');
  assert.deepEqual((await app.call('GET', '/api/comunidade', { tok: leitor.tok })).j.eu, { pode_postar: false, mod: false });
  assert.equal((await app.call('GET', '/api/comunidade', { tok: autor.tok })).j.posts[1].meu, true);
  assert.deepEqual((await app.call('GET', '/api/comunidade?tipo=noticia')).j.posts.map((p) => p.titulo), ['Beta aberto']);
});

test('Comunidade: validacao, limite diario, editar e apagar so o dono; moderador oculta e apaga', async () => {
  const app = makeApp();
  const autor = app.addUser(), outro = app.addUser(), mod = app.addUser({ mod: true });
  const criar = (tok, b) => app.call('POST', '/api/comunidade', { tok, body: b });
  for (const [b, erro] of [[post({ tipo: 'x' }), /tipo/], [post({ titulo: '' }), /título/], [post({ texto: 'curto' }), /20 caracteres/],
    [post({ link: 'javascript:alert(1)' }), /https/], [post({ tipo: 'resenha' }), /livro/]]) {
    const r = await criar(autor.tok, b); assert.equal(r.s, 400); assert.match(r.j.erro, erro);
  }
  const id = (await criar(autor.tok, post({ tipo: 'resenha', livro: 'Dom Casmurro, de Machado de Assis', texto: '<script>alert(1)</script> guardado como texto, nunca como HTML.' }))).j.id;
  const visto = (await app.call('GET', '/api/comunidade')).j.posts[0];
  assert.match(visto.texto, /^<script>/, 'texto cru; quem escapa e o navegador');
  for (let i = 0; i < 4; i++) assert.equal((await criar(autor.tok, post())).s, 200);
  assert.equal((await criar(autor.tok, post())).s, 429, 'no maximo 5 por dia');

  assert.equal((await app.call('PUT', `/api/comunidade/${id}`, { tok: outro.tok, body: post() })).s, 404);
  assert.equal((await app.call('DELETE', `/api/comunidade/${id}`, { tok: outro.tok })).s, 404);
  assert.equal((await app.call('PUT', `/api/comunidade/${id}`, { tok: autor.tok, body: post({ titulo: 'Título novo' }) })).s, 200);

  assert.equal((await app.call('POST', `/api/comunidade/${id}/ocultar`, { tok: autor.tok, body: {} })).s, 403);
  assert.equal((await app.call('POST', `/api/comunidade/${id}/ocultar`, { tok: mod.tok, body: { ocultar: true } })).s, 200);
  assert.ok(!(await app.call('GET', '/api/comunidade')).j.posts.some((p) => p.id === id), 'oculto some para o publico');
  assert.ok((await app.call('GET', '/api/comunidade', { tok: mod.tok })).j.posts.find((p) => p.id === id).oculto, 'moderador ve, marcado');
  await app.call('POST', `/api/comunidade/${id}/ocultar`, { tok: mod.tok, body: { ocultar: false } });
  assert.ok((await app.call('GET', '/api/comunidade')).j.posts.some((p) => p.id === id));
  assert.equal((await app.call('DELETE', `/api/comunidade/${id}`, { tok: mod.tok })).s, 200);
  assert.equal((await app.call('DELETE', `/api/comunidade/${id}`, { tok: autor.tok })).s, 404);
});

test('Comunidade: paginacao por "antes" e conta com e-mail pendente nao posta', async () => {
  const app = makeApp({ RESEND_API_KEY: 'x' });
  const mod = app.addUser({ mod: true });
  for (let i = 0; i < 25; i++) await app.call('POST', '/api/comunidade', { tok: mod.tok, body: post({ titulo: `Post ${i}` }) });
  const p1 = (await app.call('GET', '/api/comunidade')).j;
  assert.equal(p1.posts.length, 20); assert.ok(p1.mais);
  const p2 = (await app.call('GET', `/api/comunidade?antes=${p1.mais}`)).j;
  assert.equal(p2.posts.length, 5); assert.equal(p2.mais, null);
  assert.equal((await app.call('GET', '/api/comunidade?n=3')).j.posts.length, 3);
  const pend = app.addUser({ email_status: 'pendente' });
  assert.equal((await app.call('POST', '/api/comunidade', { tok: pend.tok, body: post() })).s, 403);
});
