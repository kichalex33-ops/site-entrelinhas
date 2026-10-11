import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp } from './helpers.mjs';
import { GENEROS, TIPOS, classificar, lerClassificacao } from '../../public/catalogo.js';

test('catalogo: so generos e tipos da lista, no maximo 2 generos, sem repeticao', () => {
  const c = lerClassificacao({ generos: ['fantasia', 'Fantasia', 'Inventado', 'Terror', 'Drama'], tipo: 'conto', serie: ' Saga · Livro II ' });
  assert.deepEqual(c, { generos: ['Fantasia', 'Terror'], tipo: 'Conto', serie: 'Saga · Livro II', genero: 'Fantasia · Terror · Saga · Livro II' });
  assert.equal(lerClassificacao({ generos: ['sdfsdfsdf'], tipo: 'qualquer' }).generos.length, 0);
  assert.equal(lerClassificacao({ tipo: 'qualquer' }).tipo, '');
  assert.ok(GENEROS.length >= 10 && TIPOS.includes('HQ'));
});

test('catalogo: livros antigos (genero em texto livre) sao reconhecidos por apelido; o resto fica de fora do filtro', () => {
  assert.deepEqual(classificar({ genero: 'Science fiction · English edition' }).generos, ['Ficção científica']);
  assert.deepEqual(classificar({ genero: 'Literatura infantil · Livro 1' }).generos, ['Infantil']);
  assert.deepEqual(classificar({ genero: 'Crônicas Cosmológicas · Livro I' }).generos, []);
  assert.deepEqual(classificar({ genero: 'sdfsdfsdf' }).generos, []);
});

test('perfil e vitrine: generos e tipo validados no servidor; livro antigo continua com o texto', async () => {
  const app = makeApp();
  const a = app.addUser({ nome: 'Ana' });
  const r = await app.call('PUT', '/api/profile', { tok: a.tok, body: { data: { nome: 'Ana', links: [], secoes: [], obras: [
    { titulo: 'Novo', status: 'Publicado', generos: ['Terror', 'xyz'], tipo: 'Conto', serie: 'Contos I' },
    { titulo: 'Antigo', status: 'Publicado', genero: 'Fantasia · Livro I' },
  ] } } });
  assert.equal(r.s, 200);
  const [novo, antigo] = r.j.data.obras;
  assert.deepEqual([novo.generos, novo.tipo, novo.genero], [['Terror'], 'Conto', 'Terror · Contos I']);
  assert.equal(antigo.genero, 'Fantasia · Livro I'); assert.equal(antigo.generos, undefined);
  const v = (await app.call('GET', '/api/vitrine')).j.livros;
  const vn = v.find((x) => x.titulo === 'Novo'), va = v.find((x) => x.titulo === 'Antigo');
  assert.deepEqual([vn.generos, vn.tipo_obra, vn.tipo], [['Terror'], 'Conto', 'divulgado']);
  assert.deepEqual([va.generos, va.tipo_obra], [['Fantasia'], '']);
});

test('Estudio: publicar pelo formulario novo exige genero e tipo; a vitrine recebe os dois', async () => {
  const app = makeApp({ ESTUDIO_PUBLICACAO: 'on' });
  const a = app.addUser({ nome: 'Ana' });
  await app.call('PUT', '/api/profile', { tok: a.tok, body: { data: { nome: 'Ana', links: [], secoes: [], obras: [] } } });
  const w = (await app.call('POST', '/api/studio/works', { tok: a.tok, body: { titulo: 'Obra' } })).j.id;
  const c = (await app.call('POST', `/api/studio/works/${w}/docs`, { tok: a.tok, body: { doc_tipo: 'capitulo', titulo: 'C1', corpo: 'x' } })).j.id;
  const dec = (await app.call('GET', `/api/studio/works/${w}/publicacao`, { tok: a.tok })).j.declaracao.versao;
  const pub = (meta) => app.call('POST', `/api/studio/works/${w}/publicacao`, { tok: a.tok, body: { acao: 'publicar', aceite: dec, meta: { titulo: 'Obra', sinopse: 's', faixa: 'L', ...meta }, docs: [c] } });
  assert.match((await pub({ generos: [], tipo: 'Romance' })).j.erro, /gênero/);
  assert.match((await pub({ generos: ['Fantasia'], tipo: '' })).j.erro, /tipo de obra/);
  assert.equal((await pub({ generos: ['Fantasia', 'Aventura'], tipo: 'Novela', serie: 'Saga · I' })).s, 200);
  const l = (await app.call('GET', '/api/vitrine')).j.livros.find((x) => x.tipo === 'estudio');
  assert.deepEqual([l.generos, l.tipo_obra, l.genero], [['Fantasia', 'Aventura'], 'Novela', 'Fantasia · Aventura · Saga · I']);
  const info = (await app.call('GET', `/api/studio/works/${w}/publicacao`, { tok: a.tok })).j.meta;
  assert.deepEqual([info.generos, info.tipo, info.serie], [['Fantasia', 'Aventura'], 'Novela', 'Saga · I']);
});

test('limpeza (migracao 0026): saem noticias e projetos ficticios; o que tem perfil ligado fica', async () => {
  const app = makeApp();
  const s = (await app.call('GET', '/api/site')).j;
  assert.deepEqual(s.noticias.map((n) => n.autor), ['Alex Jr. Kich']);
  assert.deepEqual(s.projetos, []);
  assert.ok(s.selos.length && s.servicos.length, 'selos e servicos continuam');
});
