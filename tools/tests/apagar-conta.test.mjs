import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp } from './helpers.mjs';

// os usuarios do helper nao tem senha de verdade: define uma pelo link de redefinicao e entra de novo
async function comSenha(app, mod, u, senha = 'senha-secreta-123') {
  const email = `u${u.id}@teste.local`;
  const link = (await app.call('POST', '/api/admin/reset-link', { tok: mod.tok, body: { email } })).j.link;
  await app.call('POST', '/api/redefinir', { body: { token: new URL(link).searchParams.get('token'), nova: senha } });
  const r = await app.call('POST', '/api/login', { body: { email, senha } });
  return { ...u, tok: /sid=([^;]+)/.exec(r.headers.get('set-cookie'))[1] };
}
const conta = (app, tabela, col, v) => app.db.prepare(`SELECT COUNT(*) AS n FROM ${tabela} WHERE ${col} = ?`).get(v).n;

test('apagar conta de autor: exige senha e APAGAR; some perfil, obras e o que leitores deixaram nelas', async () => {
  const app = makeApp({ ESTUDIO_PUBLICACAO: 'on' });
  const mod = app.addUser({ mod: true });
  let a = app.addUser({ nome: 'Ana' });
  const l = app.addUser({ role: 'leitor' });
  // ana entrou por convite: o vinculo nao pode travar o apagamento
  app.db.prepare('INSERT INTO invites (code_hash, used_by, created_at) VALUES (?, ?, ?)').run('h', a.id, 1);
  const obra = (await app.call('PUT', '/api/profile', { tok: a.tok, body: { data: { nome: 'Ana', links: [], secoes: [], obras: [{ titulo: 'O Rio', sinopse: 'x' }] } } })).j.data.obras[0].id;
  const w = (await app.call('POST', '/api/studio/works', { tok: a.tok, body: { titulo: 'Rascunho' } })).j.id;
  app.db.prepare('INSERT INTO images (id, user_id, mime, data, created_at) VALUES (?, ?, ?, ?, ?)').run('ab'.repeat(12), a.id, 'image/png', new Uint8Array([1]), 1);
  await app.call('PUT', '/api/reviews', { tok: l.tok, body: { autor: a.slug, obra, nota: 5, texto: 'Gostei muito deste livro aqui.' } });
  await app.call('POST', `/api/livro/${a.slug}/${obra}/favorito`, { tok: l.tok });
  await app.call('POST', `/api/livro/${a.slug}/${obra}/visita`);
  await app.call('POST', `/api/livro/${a.slug}/${obra}/denuncia`, { tok: l.tok, body: { motivo: 'spam' } });
  assert.equal(conta(app, 'reviews', 'author_slug', a.slug), 1, 'cenario com review');

  a = await comSenha(app, mod, a);
  assert.equal((await app.call('POST', '/api/conta/apagar', { tok: a.tok, body: { senha: 'senha-secreta-123' } })).s, 400, 'sem APAGAR');
  assert.equal((await app.call('POST', '/api/conta/apagar', { tok: a.tok, body: { senha: 'errada', confirmar: 'APAGAR' } })).s, 401);
  const r = await app.call('POST', '/api/conta/apagar', { tok: a.tok, body: { senha: 'senha-secreta-123', confirmar: 'APAGAR' } });
  assert.equal(r.s, 200, JSON.stringify(r.j));
  assert.match(r.headers.get('set-cookie'), /sid=;/);

  assert.equal(conta(app, 'users', 'id', a.id), 0);
  assert.equal(conta(app, 'profiles', 'slug', a.slug), 0);
  assert.equal(conta(app, 'studio_works', 'id', w), 0);
  assert.equal(conta(app, 'images', 'user_id', a.id), 0);
  assert.equal(conta(app, 'reviews', 'author_slug', a.slug), 0);
  for (const t of ['book_favorites', 'book_views', 'book_reports']) assert.equal(conta(app, t, 'obra_id', obra), 0, t);
  assert.equal(conta(app, 'sessions', 'user_id', a.id), 0);
  assert.equal((await app.call('GET', '/api/me', { tok: a.tok })).s, 401);
  assert.equal((await app.call('GET', `/api/profile/${a.slug}`)).s, 404);
  assert.equal(conta(app, 'users', 'id', l.id), 1, 'o leitor continua');
});

test('apagar conta de leitor: some a conta, as avaliacoes e os favoritos dele', async () => {
  const app = makeApp();
  const mod = app.addUser({ mod: true });
  const a = app.addUser({ nome: 'Ana' });
  let l = app.addUser({ role: 'leitor' });
  const obra = (await app.call('PUT', '/api/profile', { tok: a.tok, body: { data: { nome: 'Ana', links: [], secoes: [], obras: [{ titulo: 'O Rio', sinopse: 'x' }] } } })).j.data.obras[0].id;
  await app.call('PUT', '/api/reviews', { tok: l.tok, body: { autor: a.slug, obra, nota: 4, texto: 'Bom livro, recomendo.' } });
  await app.call('POST', `/api/livro/${a.slug}/${obra}/favorito`, { tok: l.tok });
  l = await comSenha(app, mod, l);
  assert.equal((await app.call('POST', '/api/conta/apagar', { tok: l.tok, body: { senha: 'senha-secreta-123', confirmar: 'APAGAR' } })).s, 200);
  assert.equal(conta(app, 'users', 'id', l.id), 0);
  assert.equal(conta(app, 'reviews', 'user_id', l.id), 0);
  assert.equal(conta(app, 'book_favorites', 'user_id', l.id), 0);
  assert.equal(conta(app, 'profiles', 'slug', a.slug), 1, 'o perfil da autora continua');
});
