// Primeiros passos: cada passo marcado pelos dados reais; a lista fica completa so com tudo feito.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp } from './helpers.mjs';

const passos = async (app, tok) => (await app.call('GET', '/api/onboarding', { tok })).j;
const feitos = (o) => o.passos.filter((p) => p.feito).map((p) => p.chave);

test('autor: perfil, obra, manuscrito, dados e publicacao marcam sozinhos', async () => {
  const app = makeApp({ ESTUDIO_PUBLICACAO: 'on' });
  const a = app.addUser({ nome: 'Ana' });
  let o = await passos(app, a.tok);
  assert.equal(o.papel, 'autor'); assert.equal(o.passos.length, 5); assert.deepEqual(feitos(o), []); assert.equal(o.completo, false);
  assert.equal((await app.call('GET', '/api/onboarding')).s, 401);

  app.db.prepare('INSERT INTO images (id, user_id, mime, data, created_at) VALUES (?, ?, ?, ?, ?)').run('ab'.repeat(12), a.id, 'image/png', new Uint8Array([1]), 1);
  await app.call('PUT', '/api/profile', { tok: a.tok, body: { data: { nome: 'Ana', frase: 'Escrevo rios.', retrato: 'ab'.repeat(12), links: [], secoes: [], obras: [] } } });
  const w = (await app.call('POST', '/api/studio/works', { tok: a.tok, body: { titulo: 'O Rio' } })).j.id;
  assert.deepEqual(feitos(await passos(app, a.tok)), ['perfil', 'obra']);
  const c = (await app.call('POST', `/api/studio/works/${w}/docs`, { tok: a.tok, body: { doc_tipo: 'capitulo', titulo: 'Um', corpo: 'A margem do rio estava fria.' } })).j.id;
  await app.call('PATCH', `/api/studio/works/${w}`, { tok: a.tok, body: { meta: { sinopse: 'Uma menina e um rio.', genero: 'Fantasia' } } });
  assert.deepEqual(feitos(await passos(app, a.tok)), ['perfil', 'obra', 'manuscrito', 'dados']);
  const dec = (await app.call('GET', `/api/studio/works/${w}/publicacao`, { tok: a.tok })).j.declaracao.versao;
  const pub = await app.call('POST', `/api/studio/works/${w}/publicacao`, { tok: a.tok, body: { acao: 'publicar', aceite: dec, meta: { titulo: 'O Rio', sinopse: 'Uma menina e um rio.', genero: 'Fantasia', faixa: '12' }, docs: [c] } });
  assert.equal(pub.s, 200, JSON.stringify(pub.j));
  o = await passos(app, a.tok);
  assert.equal(o.completo, true); assert.equal(feitos(o).length, 5);
});

test('leitor: completa com estante, seguir e favoritar ou avaliar; o perfil e opcional', async () => {
  const app = makeApp();
  const a = app.addUser({ nome: 'Ana' });
  const rp = await app.call('PUT', '/api/profile', { tok: a.tok, body: { data: { nome: 'Ana', links: [], secoes: [], obras: [{ titulo: 'O Rio', status: 'Publicado' }] } } });
  const obra = rp.j.data.obras[0].id;
  const l = app.addUser({ role: 'leitor', nome: 'Lia' });
  let o = await passos(app, l.tok);
  assert.equal(o.papel, 'leitor'); assert.equal(o.passos.find((p) => p.chave === 'perfil').opcional, true);
  const e = (await app.call('GET', '/api/estantes', { tok: l.tok })).j;
  await app.call('POST', `/api/estantes/${e.listas[0].id}/livro`, { tok: l.tok, body: { autor: a.slug, obra } });
  await app.call('POST', `/api/seguir/${a.slug}`, { tok: l.tok });
  o = await passos(app, l.tok);
  assert.deepEqual(feitos(o), ['estante', 'seguir']); assert.equal(o.completo, false);
  await app.call('POST', `/api/livro/${a.slug}/${obra}/favorito`, { tok: l.tok });
  o = await passos(app, l.tok);
  assert.equal(o.completo, true, 'sem foto nem avaliacao ja e atividade suficiente');
});
