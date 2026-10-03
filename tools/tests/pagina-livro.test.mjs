import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp } from './helpers.mjs';

const perfil = (obras) => ({ nome: 'Ana Autora', links: [], secoes: [], obras });
const img = (app, id, userId) => app.db.prepare('INSERT INTO images (id, user_id, mime, data, created_at) VALUES (?, ?, ?, ?, ?)').run(id, userId, 'image/png', new Uint8Array([1]), 1);

async function cenario() {
  const app = makeApp({ ESTUDIO_PUBLICACAO: 'on' });
  const a = app.addUser({ nome: 'Ana Autora' });
  const r = await app.call('PUT', '/api/profile', { tok: a.tok, body: { data: perfil([{ titulo: 'Livro de Fora', faixa: '14', sinopse: 'Sinopse curta.' }]) } });
  return { app, a, obra: r.j.data.obras[0].id };
}

test('pagina do livro divulgado: o dono preenche, o publico ve; outro autor nao edita', async () => {
  const { app, a, obra } = await cenario();
  let g = await app.call('GET', `/api/livro/${a.slug}/${obra}`);
  assert.equal(g.s, 200, JSON.stringify(g.j));
  assert.equal(g.j.tipo, 'divulgado'); assert.equal(g.j.obra.titulo, 'Livro de Fora'); assert.equal(g.j.dono, false);
  assert.deepEqual(g.j.pagina.personagens, []);

  img(app, 'aa'.repeat(12), a.id);
  const dados = {
    alt_titulos: 'The Outside Book', contexto: 'Escrito durante a pandemia.', estilo: 'Narrador em primeira pessoa, tom melancólico.',
    personagens: [{ nome: 'Kayla', papel: 'Protagonista', descricao: 'Lembra de tudo.', imagem: 'aa'.repeat(12) }, { nome: '', papel: 'sem nome some' }],
    imagens: [{ id: 'aa'.repeat(12), legenda: 'Mapa do rio' }, { id: 'ff'.repeat(12), legenda: 'nao existe' }],
    materiais: [{ rotulo: 'Trilha sonora', url: 'https://exemplo.com/trilha' }, { rotulo: 'Ruim', url: 'javascript:alert(1)' }],
  };
  const p = await app.call('PUT', `/api/livro/${obra}`, { tok: a.tok, body: { data: dados } });
  assert.equal(p.s, 200, JSON.stringify(p.j));
  assert.equal(p.j.pagina.personagens.length, 1);
  assert.equal(p.j.pagina.imagens.length, 1, 'imagem que nao e do autor sai');
  assert.equal(p.j.pagina.materiais.length, 1, 'link invalido sai');

  g = await app.call('GET', `/api/livro/${a.slug}/${obra}`, { tok: a.tok });
  assert.equal(g.j.dono, true);
  assert.equal(g.j.pagina.personagens[0].nome, 'Kayla');
  assert.equal(g.j.pagina.estilo, 'Narrador em primeira pessoa, tom melancólico.');

  const b = app.addUser();
  assert.equal((await app.call('PUT', `/api/livro/${obra}`, { tok: b.tok, body: { data: dados } })).s, 404, 'obra de outra pessoa');
  assert.equal((await app.call('PUT', `/api/livro/${obra}`, { body: { data: dados } })).s, 401);
  const leitor = app.addUser({ role: 'leitor' });
  assert.equal((await app.call('PUT', `/api/livro/${obra}`, { tok: leitor.tok, body: { data: dados } })).s, 403);
});

test('pagina do livro do Estudio: so aparece publicada, com capitulos; o autor prepara antes de publicar', async () => {
  const app = makeApp({ ESTUDIO_PUBLICACAO: 'on' });
  const a = app.addUser({ nome: 'Ana' });
  const w = (await app.call('POST', '/api/studio/works', { tok: a.tok, body: { titulo: 'O Rio' } })).j.id;
  const c1 = (await app.call('POST', `/api/studio/works/${w}/docs`, { tok: a.tok, body: { doc_tipo: 'capitulo', titulo: 'Cap 1', corpo: 'Texto.' } })).j.id;
  assert.equal((await app.call('GET', `/api/livro/${a.slug}/${w}`)).s, 404, 'rascunho nao aparece');
  assert.equal((await app.call('PUT', `/api/livro/${w}`, { tok: a.tok, body: { data: { contexto: 'Preparado antes.' } } })).s, 200, 'pode preparar antes');

  const dec = (await app.call('GET', `/api/studio/works/${w}/publicacao`, { tok: a.tok })).j.declaracao.versao;
  await app.call('POST', `/api/studio/works/${w}/publicacao`, { tok: a.tok, body: { acao: 'publicar', aceite: dec, meta: { titulo: 'O Rio', sinopse: 'Um rio.', faixa: 'L' }, docs: [c1] } });
  const g = await app.call('GET', `/api/livro/${a.slug}/${w}`);
  assert.equal(g.s, 200, JSON.stringify(g.j));
  assert.equal(g.j.tipo, 'estudio'); assert.equal(g.j.obra.faixa, 'L');
  assert.equal(g.j.capitulos.length, 1); assert.match(g.j.obra.url, /^ler\.html\?a=/);
  assert.equal(g.j.pagina.contexto, 'Preparado antes.');
});

test('limpeza de imagens nao apaga as usadas na pagina do livro', async () => {
  const { app, a, obra } = await cenario();
  img(app, 'bb'.repeat(12), a.id); img(app, 'cc'.repeat(12), a.id);
  await app.call('PUT', `/api/livro/${obra}`, { tok: a.tok, body: { data: { imagens: [{ id: 'bb'.repeat(12) }] } } });
  await app.call('PUT', '/api/profile', { tok: a.tok, body: { data: perfil([{ id: obra, titulo: 'Livro de Fora' }]) } });
  const ids = app.db.prepare('SELECT id FROM images WHERE user_id = ?').all(a.id).map((r) => r.id);
  assert.ok(ids.includes('bb'.repeat(12)), 'imagem da galeria fica');
  assert.ok(!ids.includes('cc'.repeat(12)), 'imagem sem uso sai');
});
