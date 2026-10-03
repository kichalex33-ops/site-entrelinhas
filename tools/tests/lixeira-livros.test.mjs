import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp } from './helpers.mjs';

const perfil = (obras) => ({ nome: 'Ana', links: [], secoes: [], obras });
const img = (app, id, userId) => app.db.prepare('INSERT INTO images (id, user_id, mime, data, created_at) VALUES (?, ?, ?, ?, ?)').run(id, userId, 'image/png', new Uint8Array([1]), 1);
const conta = (app, tabela, col, v) => app.db.prepare(`SELECT COUNT(*) AS n FROM ${tabela} WHERE ${col} = ?`).get(v).n;

async function cenario() {
  const app = makeApp({ ESTUDIO_PUBLICACAO: 'on' });
  const a = app.addUser({ nome: 'Ana' });
  const l = app.addUser({ role: 'leitor' });
  img(app, 'ca'.repeat(12), a.id);
  const r = await app.call('PUT', '/api/profile', { tok: a.tok, body: { data: perfil([{ titulo: 'O Rio', sinopse: 'x', capa: 'ca'.repeat(12) }, { titulo: 'Fica', sinopse: 'y' }]) } });
  const [rio, fica] = r.j.data.obras;
  await app.call('PUT', '/api/reviews', { tok: l.tok, body: { autor: a.slug, obra: rio.id, nota: 5, texto: 'Gostei demais deste livro.' } });
  await app.call('POST', `/api/livro/${a.slug}/${rio.id}/favorito`, { tok: l.tok });
  return { app, a, l, rio, fica };
}

test('livro removido do perfil vai para a lixeira e volta com avaliacoes, favoritos e capa', async () => {
  const { app, a, rio, fica } = await cenario();
  // remove "O Rio" (como o botao Remover faz: salva o perfil sem ele)
  await app.call('PUT', '/api/profile', { tok: a.tok, body: { data: perfil([fica]) } });
  assert.equal((await app.call('GET', `/api/livro/${a.slug}/${rio.id}`)).s, 404, 'some do site');
  assert.ok(app.db.prepare('SELECT 1 FROM images WHERE id = ?').get('ca'.repeat(12)), 'a capa nao e apagada pela limpeza');

  const lx = await app.call('GET', '/api/lixeira', { tok: a.tok });
  assert.equal(lx.s, 200);
  assert.deepEqual(lx.j.itens.map((i) => [i.titulo, i.tipo, i.avaliacoes, i.favoritos]), [['O Rio', 'perfil', 1, 1]]);

  const r = await app.call('POST', `/api/lixeira/${rio.id}/restaurar`, { tok: a.tok });
  assert.equal(r.s, 200, JSON.stringify(r.j));
  const g = await app.call('GET', `/api/livro/${a.slug}/${rio.id}`);
  assert.equal(g.s, 200); assert.equal(g.j.avaliacoes.total, 1); assert.equal(g.j.numeros.favoritos, 1);
  assert.equal(g.j.obra.capa, 'ca'.repeat(12));
  assert.equal((await app.call('GET', '/api/lixeira', { tok: a.tok })).j.itens.length, 0);
});

test('excluir definitivamente: so o que esta na lixeira; leva avaliacoes, favoritos e capa', async () => {
  const { app, a, rio, fica } = await cenario();
  assert.equal((await app.call('DELETE', `/api/lixeira/${fica.id}`, { tok: a.tok })).s, 404, 'livro ativo nao se exclui por aqui');
  await app.call('PUT', '/api/profile', { tok: a.tok, body: { data: perfil([fica]) } });
  const b = app.addUser();
  assert.equal((await app.call('DELETE', `/api/lixeira/${rio.id}`, { tok: b.tok })).s, 404, 'lixeira de outro autor');
  assert.equal((await app.call('POST', `/api/lixeira/${rio.id}/restaurar`, { tok: b.tok })).s, 404);
  app.db.prepare('UPDATE images SET created_at = 1').run();
  assert.equal((await app.call('DELETE', `/api/lixeira/${rio.id}`, { tok: a.tok })).s, 200);
  assert.equal(conta(app, 'reviews', 'obra_id', rio.id), 0);
  assert.equal(conta(app, 'book_favorites', 'obra_id', rio.id), 0);
  assert.equal(conta(app, 'book_trash', 'obra_id', rio.id), 0);
  assert.equal(conta(app, 'images', 'id', 'ca'.repeat(12)), 0, 'capa sem uso sai');
  assert.equal((await app.call('POST', `/api/lixeira/${rio.id}/restaurar`, { tok: a.tok })).s, 404);
});

test('obras excluidas no Estudio aparecem na lixeira, voltam e podem ser excluidas de vez', async () => {
  const app = makeApp({ ESTUDIO_PUBLICACAO: 'on' });
  const a = app.addUser({ nome: 'Ana' });
  const w = (await app.call('POST', '/api/studio/works', { tok: a.tok, body: { titulo: 'Rascunho' } })).j.id;
  await app.call('DELETE', `/api/studio/works/${w}`, { tok: a.tok });
  let lx = (await app.call('GET', '/api/lixeira', { tok: a.tok })).j.itens;
  assert.deepEqual(lx.map((i) => [i.titulo, i.tipo]), [['Rascunho', 'estudio']]);
  assert.equal((await app.call('POST', `/api/lixeira/${w}/restaurar`, { tok: a.tok })).s, 200);
  assert.equal((await app.call('GET', `/api/studio/works/${w}`, { tok: a.tok })).s, 200, 'voltou ao Estudio');
  await app.call('DELETE', `/api/studio/works/${w}`, { tok: a.tok });
  assert.equal((await app.call('DELETE', `/api/lixeira/${w}`, { tok: a.tok })).s, 200);
  assert.equal(conta(app, 'studio_works', 'id', w), 0);
  lx = (await app.call('GET', '/api/lixeira', { tok: a.tok })).j.itens;
  assert.equal(lx.length, 0);
});

test('lixeira: restaurar respeita o limite de 20 livros; leitor nao tem lixeira', async () => {
  const { app, a, rio, l } = await cenario();
  await app.call('PUT', '/api/profile', { tok: a.tok, body: { data: perfil(Array.from({ length: 20 }, (_, i) => ({ titulo: 'L' + i }))) } });
  assert.equal((await app.call('POST', `/api/lixeira/${rio.id}/restaurar`, { tok: a.tok })).s, 409);
  assert.equal((await app.call('GET', '/api/lixeira', { tok: l.tok })).s, 403);
});

test('depois de 15 dias na lixeira a tarefa diaria exclui de vez; antes disso, nao', async () => {
  const { app, a, rio, fica } = await cenario();
  const w = (await app.call('POST', '/api/studio/works', { tok: a.tok, body: { titulo: 'Velha' } })).j.id;
  await app.call('DELETE', `/api/studio/works/${w}`, { tok: a.tok });
  await app.call('PUT', '/api/profile', { tok: a.tok, body: { data: perfil([fica]) } });
  const lx = (await app.call('GET', '/api/lixeira', { tok: a.tok })).j;
  assert.equal(lx.prazo_dias, 15);
  const it = lx.itens.find((i) => i.id === rio.id);
  assert.equal(it.exclui_em - it.removido_em, 15 * 86400);

  const rodar = async () => { const p = []; await app.worker.scheduled({}, app.env, { waitUntil: (x) => p.push(x) }); await Promise.all(p); };
  const agora = Math.floor(Date.now() / 1000);
  app.db.prepare('UPDATE book_trash SET removed_at = ?').run(agora - 14 * 86400);
  app.db.prepare('UPDATE studio_works SET deleted_at = ? WHERE id = ?').run(agora - 14 * 86400, w);
  await rodar();
  assert.equal((await app.call('GET', '/api/lixeira', { tok: a.tok })).j.itens.length, 2, '14 dias: continua');

  app.db.prepare('UPDATE book_trash SET removed_at = ?').run(agora - 16 * 86400);
  app.db.prepare('UPDATE studio_works SET deleted_at = ? WHERE id = ?').run(agora - 16 * 86400, w);
  app.db.prepare('UPDATE images SET created_at = 1').run();
  await rodar();
  assert.equal((await app.call('GET', '/api/lixeira', { tok: a.tok })).j.itens.length, 0, '16 dias: excluido');
  assert.equal(conta(app, 'reviews', 'obra_id', rio.id), 0);
  assert.equal(conta(app, 'studio_works', 'id', w), 0);
  assert.equal(conta(app, 'images', 'id', 'ca'.repeat(12)), 0, 'a capa sai junto');
});

test('livro removido antes da lixeira existir: aparece como recuperavel e volta com as avaliacoes', async () => {
  const { app, a, rio, fica } = await cenario();
  // simula a remocao antiga: o livro some do perfil sem passar pela lixeira
  const d = JSON.parse(app.db.prepare('SELECT data FROM profiles WHERE user_id = ?').get(a.id).data);
  d.obras = d.obras.filter((o) => o.id !== rio.id);
  app.db.prepare('UPDATE profiles SET data = ? WHERE user_id = ?').run(JSON.stringify(d), a.id);

  const lx = (await app.call('GET', '/api/lixeira', { tok: a.tok })).j.itens;
  assert.deepEqual(lx.map((i) => [i.id, i.tipo, i.avaliacoes, i.exclui_em]), [[rio.id, 'orfao', 1, 0]]);
  assert.equal((await app.call('POST', `/api/lixeira/${rio.id}/restaurar`, { tok: a.tok, body: {} })).s, 400, 'pede o titulo');
  const b = app.addUser();
  assert.equal((await app.call('POST', `/api/lixeira/${rio.id}/restaurar`, { tok: b.tok, body: { titulo: 'Roubo' } })).s, 404, 'outro autor nao pega');
  assert.equal((await app.call('POST', `/api/lixeira/${rio.id}/restaurar`, { tok: a.tok, body: { titulo: 'O Rio' } })).s, 200);
  const g = await app.call('GET', `/api/livro/${a.slug}/${rio.id}`);
  assert.equal(g.j.obra.titulo, 'O Rio'); assert.equal(g.j.avaliacoes.total, 1);
  assert.equal((await app.call('GET', '/api/lixeira', { tok: a.tok })).j.itens.length, 0);
  assert.ok(fica);
});
