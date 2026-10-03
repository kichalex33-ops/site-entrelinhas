import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp } from './helpers.mjs';

async function cenario() {
  const app = makeApp();
  const a = app.addUser({ nome: 'Ana' });
  const r = await app.call('PUT', '/api/profile', { tok: a.tok, body: { data: { nome: 'Ana Autora', links: [], secoes: [], obras: [{ titulo: 'O Rio', status: 'Publicado' }, { titulo: 'A Ponte', status: 'Publicado' }] } } });
  const [rio, ponte] = r.j.data.obras.map((o) => o.id);
  const l = app.addUser({ role: 'leitor', nome: 'Lia' });
  return { app, a, l, rio, ponte };
}
const lista = (j, chave) => j.listas.find((x) => x.chave === chave);

test('perfil de leitor: nome, bio e foto; avaliacoes e favoritos aparecem com o livro', async () => {
  const { app, a, l, rio } = await cenario();
  await app.call('PUT', '/api/reviews', { tok: l.tok, body: { autor: a.slug, obra: rio, nota: 5, texto: 'Li em uma noite so, recomendo.' } });
  await app.call('POST', `/api/livro/${a.slug}/${rio}/favorito`, { tok: l.tok });
  app.db.prepare('INSERT INTO images (id, user_id, mime, data, created_at) VALUES (?, ?, ?, ?, ?)').run('fa'.repeat(12), l.id, 'image/png', new Uint8Array([1]), 1);
  app.db.prepare('INSERT INTO images (id, user_id, mime, data, created_at) VALUES (?, ?, ?, ?, ?)').run('fb'.repeat(12), l.id, 'image/png', new Uint8Array([1]), 1);

  assert.equal((await app.call('PUT', '/api/leitor', { tok: l.tok, body: { nome: 'L', bio: '' } })).s, 400);
  const s = await app.call('PUT', '/api/leitor', { tok: l.tok, body: { nome: 'Lia Leitora', bio: 'Leio fantasia e suspense.', foto: 'fa'.repeat(12) } });
  assert.equal(s.s, 200, JSON.stringify(s.j));
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM images WHERE user_id = ?').get(l.id).n, 1, 'foto trocada sai');

  const p = await app.call('GET', `/api/leitor/${l.slug}`);
  assert.equal(p.s, 200);
  assert.equal(p.j.nome, 'Lia Leitora'); assert.equal(p.j.bio, 'Leio fantasia e suspense.'); assert.equal(p.j.dono, false);
  assert.equal(p.j.avaliacoes[0].livro.titulo, 'O Rio'); assert.equal(p.j.avaliacoes[0].nota, 5);
  assert.deepEqual(p.j.favoritos.map((x) => x.titulo), ['O Rio']);
  const rv = await app.call('GET', `/api/reviews?autor=${a.slug}&obra=${rio}`);
  assert.equal(rv.j.reviews[0].leitor, l.slug, 'review leva ao perfil do leitor');
  assert.equal((await app.call('GET', '/api/leitor/nao-existe')).s, 404);
});

test('seguir autor: liga e desliga, conta seguidores, aparece no perfil; nao segue a si mesmo', async () => {
  const { app, a, l } = await cenario();
  assert.deepEqual((await app.call('GET', `/api/seguir/${a.slug}`)).j, { seguidores: 0, seguindo: false, proprio: false });
  assert.equal((await app.call('POST', `/api/seguir/${a.slug}`)).s, 401);
  assert.deepEqual((await app.call('POST', `/api/seguir/${a.slug}`, { tok: l.tok })).j, { seguidores: 1, seguindo: true, proprio: false });
  assert.equal((await app.call('POST', `/api/seguir/${a.slug}`, { tok: a.tok })).s, 403);
  assert.deepEqual((await app.call('GET', `/api/leitor/${l.slug}`)).j.seguindo.map((s) => [s.nome, s.tipo]), [['Ana Autora', 'autor']]);
  assert.deepEqual((await app.call('POST', `/api/seguir/${a.slug}`, { tok: l.tok })).j.seguindo, false);
  assert.equal((await app.call('POST', '/api/seguir/ninguem', { tok: l.tok })).s, 404);
  // leitor segue leitor; contadores no perfil
  const m = app.addUser({ role: 'leitor', nome: 'Mel' });
  assert.equal((await app.call('POST', `/api/seguir/${l.slug}`, { tok: m.tok })).j.seguidores, 1);
  const p = (await app.call('GET', `/api/leitor/${l.slug}`, { tok: m.tok })).j;
  assert.equal(p.seguidores, 1); assert.equal(p.eu_sigo, true);
  assert.equal((await app.call('GET', `/api/leitor/${m.slug}`)).j.seguindo_total, 1);
});

test('perfil privado: visitante ve so nome e foto; o dono ve tudo; a engrenagem muda so a privacidade', async () => {
  const { app, a, l, rio } = await cenario();
  await app.call('PUT', '/api/leitor', { tok: l.tok, body: { nome: 'Lia', bio: 'Bio guardada', local: 'Recife' } });
  await app.call('PUT', '/api/reviews', { tok: l.tok, body: { autor: a.slug, obra: rio, nota: 4, texto: 'Bom livro, gostei bastante.' } });
  assert.equal((await app.call('PUT', '/api/leitor', { tok: l.tok, body: { privado: true } })).j.privado, true);
  const v = (await app.call('GET', `/api/leitor/${l.slug}`)).j;
  assert.equal(v.bloqueado, true); assert.equal(v.nome, 'Lia');
  assert.equal(v.avaliacoes, undefined); assert.equal(v.bio, undefined);
  const d = (await app.call('GET', `/api/leitor/${l.slug}`, { tok: l.tok })).j;
  assert.equal(d.bloqueado, undefined); assert.equal(d.bio, 'Bio guardada', 'mudar so a privacidade nao apaga a bio');
  assert.equal(d.local, 'Recife'); assert.equal(d.avaliacoes.length, 1);
  assert.equal(d.atividade[0].tipo, 'avaliou');
});

test('estantes: as cinco fixas se excluem; listas proprias; listas ocultas so o dono ve', async () => {
  const { app, a, l, rio, ponte } = await cenario();
  let e = (await app.call('GET', '/api/estantes', { tok: l.tok })).j;
  assert.deepEqual(e.listas.map((x) => x.nome), ['Lendo', 'Quero ler', 'Lidos', 'Pausado', 'Abandonado']);
  const livro = (lid, obra) => app.call('POST', `/api/estantes/${lid}/livro`, { tok: l.tok, body: { autor: a.slug, obra } });

  e = (await livro(lista(e, 'quero').id, rio)).j;
  e = (await livro(lista(e, 'lendo').id, rio)).j;
  assert.deepEqual(lista(e, 'quero').obras, [], 'saiu de Quero ler');
  assert.deepEqual(lista(e, 'lendo').obras, [rio]);
  assert.equal((await livro(lista(e, 'lidos').id, 'ffffffffffff')).s, 404, 'livro inexistente');

  e = (await app.call('POST', '/api/estantes', { tok: l.tok, body: { nome: 'Para as férias' } })).j;
  const ferias = e.listas.find((x) => x.nome === 'Para as férias');
  e = (await livro(ferias.id, rio)).j;
  e = (await livro(ferias.id, ponte)).j;
  assert.deepEqual(lista(e, 'lendo').obras, [rio], 'lista propria nao mexe nas fixas');
  e = (await app.call('PATCH', `/api/estantes/${ferias.id}`, { tok: l.tok, body: { publica: false, nome: 'Férias' } })).j;
  assert.equal(e.listas.find((x) => x.id === ferias.id).nome, 'Férias');
  assert.equal((await app.call('PATCH', `/api/estantes/${lista(e, 'lidos').id}`, { tok: l.tok, body: { nome: 'X' } })).s, 403);

  const publico = (await app.call('GET', `/api/leitor/${l.slug}`)).j;
  assert.deepEqual(publico.listas.map((x) => x.nome), ['Lendo', 'Quero ler', 'Lidos', 'Pausado', 'Abandonado'], 'oculta nao aparece');
  assert.deepEqual(lista(publico, 'lendo').livros.map((x) => x.titulo), ['O Rio']);
  const meu = (await app.call('GET', `/api/leitor/${l.slug}`, { tok: l.tok })).j;
  assert.equal(meu.listas.find((x) => x.nome === 'Férias').livros.length, 2);

  const outro = app.addUser({ role: 'leitor' });
  assert.equal((await app.call('POST', `/api/estantes/${ferias.id}/livro`, { tok: outro.tok, body: { autor: a.slug, obra: rio } })).s, 404, 'lista de outra pessoa');
  assert.equal((await app.call('DELETE', `/api/estantes/${lista(e, 'quero').id}`, { tok: l.tok })).s, 404, 'fixa nao se apaga');
  assert.equal((await app.call('DELETE', `/api/estantes/${ferias.id}`, { tok: l.tok })).s, 200);
});
