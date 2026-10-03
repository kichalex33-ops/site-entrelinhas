import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp } from './helpers.mjs';

const perfil = (obras) => ({ nome: 'Ana Autora', links: [], secoes: [], obras });
const img = (app, id, userId) => app.db.prepare('INSERT INTO images (id, user_id, mime, data, created_at) VALUES (?, ?, ?, ?, ?)').run(id, userId, 'image/png', new Uint8Array([1]), 1);

async function cenario() {
  const app = makeApp({ ESTUDIO_PUBLICACAO: 'on' });
  const a = app.addUser({ nome: 'Ana Autora' });
  const r = await app.call('PUT', '/api/profile', { tok: a.tok, body: { data: perfil([{ titulo: 'Livro de Fora', sinopse: 'Sinopse.' }]) } });
  return { app, a, obra: r.j.data.obras[0].id };
}

test('tags e lojas na pagina do livro: normalizadas e com link valido', async () => {
  const { app, a, obra } = await cenario();
  const p = await app.call('PUT', `/api/livro/${obra}`, { tok: a.tok, body: { data: {
    tags: ['#Suspense', 'Ficção Científica', 'suspense', '', '<b>x</b>'],
    lojas: [{ rotulo: 'Google Play', url: 'https://play.google.com/x' }, { rotulo: 'Ruim', url: 'javascript:alert(1)' }],
  } } });
  assert.equal(p.s, 200, JSON.stringify(p.j));
  assert.deepEqual(p.j.pagina.tags, ['suspense', 'ficção-científica', 'bxb'], 'sem #, espacos, repetidas nem sinais');
  assert.deepEqual(p.j.pagina.lojas, [{ rotulo: 'Google Play', url: 'https://play.google.com/x' }]);
});

test('favoritos: liga e desliga, conta, exige login', async () => {
  const { app, a, obra } = await cenario();
  const l = app.addUser({ role: 'leitor' });
  assert.equal((await app.call('POST', `/api/livro/${a.slug}/${obra}/favorito`)).s, 401);
  let f = await app.call('POST', `/api/livro/${a.slug}/${obra}/favorito`, { tok: l.tok });
  assert.deepEqual(f.j, { favorito: true, total: 1 });
  let g = await app.call('GET', `/api/livro/${a.slug}/${obra}`, { tok: l.tok });
  assert.equal(g.j.favorito, true); assert.equal(g.j.numeros.favoritos, 1);
  f = await app.call('POST', `/api/livro/${a.slug}/${obra}/favorito`, { tok: l.tok });
  assert.deepEqual(f.j, { favorito: false, total: 0 });
  assert.equal((await app.call('POST', `/api/livro/${a.slug}/ffffffffffff/favorito`, { tok: l.tok })).s, 404);
});

test('visualizacoes: uma por visitante por dia; o dono nao conta', async () => {
  const { app, a, obra } = await cenario();
  const l = app.addUser({ role: 'leitor' });
  await app.call('POST', `/api/livro/${a.slug}/${obra}/visita`, { ip: '2.2.2.2' });
  await app.call('POST', `/api/livro/${a.slug}/${obra}/visita`, { ip: '2.2.2.2' });
  await app.call('POST', `/api/livro/${a.slug}/${obra}/visita`, { ip: '3.3.3.3' });
  await app.call('POST', `/api/livro/${a.slug}/${obra}/visita`, { tok: l.tok });
  await app.call('POST', `/api/livro/${a.slug}/${obra}/visita`, { tok: a.tok });
  const g = await app.call('GET', `/api/livro/${a.slug}/${obra}`);
  assert.equal(g.j.numeros.visualizacoes, 3);
  assert.equal((await app.call('POST', `/api/livro/${a.slug}/ffffffffffff/visita`)).s, 404);
});

test('numero publico de denuncias nao conta as arquivadas', async () => {
  const { app, a, obra } = await cenario();
  const mod = app.addUser({ mod: true });
  for (const u of [app.addUser({ role: 'leitor' }), app.addUser({ role: 'leitor' })]) {
    await app.call('POST', `/api/livro/${a.slug}/${obra}/denuncia`, { tok: u.tok, body: { motivo: 'spam' } });
  }
  const lista = (await app.call('GET', '/api/admin/denuncias-livros', { tok: mod.tok })).j;
  await app.call('POST', `/api/admin/denuncias-livros/${lista[0].id}`, { tok: mod.tok, body: { acao: 'arquivar' } });
  const g = await app.call('GET', `/api/livro/${a.slug}/${obra}`);
  assert.equal(g.j.numeros.denuncias, 1);
});

test('extras e notas: o dono publica e apaga; leitores curtem; outros nao publicam', async () => {
  const { app, a, obra } = await cenario();
  img(app, 'dd'.repeat(12), a.id);
  assert.equal((await app.call('POST', `/api/livro/${obra}/posts`, { tok: a.tok, body: { texto: '' } })).s, 400);
  let p = await app.call('POST', `/api/livro/${obra}/posts`, { tok: a.tok, body: { texto: 'Capítulo 4 quase pronto!' } });
  assert.equal(p.s, 200, JSON.stringify(p.j));
  p = await app.call('POST', `/api/livro/${obra}/posts`, { tok: a.tok, body: { texto: 'O irmão está vivo.', spoiler: true, imagem: 'dd'.repeat(12) } });
  assert.equal(p.j.posts.length, 2);
  const [spoiler, aviso] = p.j.posts;
  assert.equal(spoiler.spoiler, true); assert.equal(spoiler.imagem, 'dd'.repeat(12)); assert.equal(aviso.spoiler, false);

  const b = app.addUser();
  assert.equal((await app.call('POST', `/api/livro/${obra}/posts`, { tok: b.tok, body: { texto: 'invasor' } })).s, 404);
  const l = app.addUser({ role: 'leitor' });
  assert.equal((await app.call('POST', `/api/livro/${obra}/posts`, { tok: l.tok, body: { texto: 'x' } })).s, 403);

  let c = await app.call('POST', `/api/livro/posts/${aviso.id}/curtir`, { tok: l.tok });
  assert.deepEqual(c.j, { curti: true, curtidas: 1 });
  const g = await app.call('GET', `/api/livro/${a.slug}/${obra}`, { tok: l.tok });
  assert.equal(g.j.posts.find((x) => x.id === aviso.id).curti, true);
  c = await app.call('POST', `/api/livro/posts/${aviso.id}/curtir`, { tok: l.tok });
  assert.deepEqual(c.j, { curti: false, curtidas: 0 });

  // a limpeza de imagens nao apaga a imagem de um post
  await app.call('PUT', '/api/profile', { tok: a.tok, body: { data: perfil([{ id: obra, titulo: 'Livro de Fora' }]) } });
  assert.ok(app.db.prepare('SELECT 1 FROM images WHERE id = ?').get('dd'.repeat(12)), 'imagem do post fica');

  assert.equal((await app.call('DELETE', `/api/livro/${obra}/posts/${spoiler.id}`, { tok: b.tok })).s, 404, 'so o dono apaga');
  const d = await app.call('DELETE', `/api/livro/${obra}/posts/${spoiler.id}`, { tok: a.tok });
  assert.equal(d.s, 200); assert.equal(d.j.posts.length, 1);
});
