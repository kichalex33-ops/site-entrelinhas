import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp } from './helpers.mjs';

test('vitrine: livros publicados dos perfis e obras do Estudio, com nota media; rascunhos e projetos ficam fora', async () => {
  const app = makeApp({ ESTUDIO_PUBLICACAO: 'on' });
  const a = app.addUser({ nome: 'Ana' });
  const r = await app.call('PUT', '/api/profile', { tok: a.tok, body: { data: { nome: 'Ana', links: [], secoes: [], obras: [
    { titulo: 'Publicado Fora', status: 'Publicado', faixa: '12', publicado_em: '2024' },
    { titulo: 'Ainda Escrevendo', status: 'Em escrita' },
  ] } } });
  const idFora = r.j.data.obras[0].id;
  const w = (await app.call('POST', '/api/studio/works', { tok: a.tok, body: { titulo: 'Do Estúdio' } })).j.id;
  const c = (await app.call('POST', `/api/studio/works/${w}/docs`, { tok: a.tok, body: { doc_tipo: 'capitulo', titulo: 'C1', corpo: 'x' } })).j.id;
  await app.call('POST', '/api/studio/works', { tok: a.tok, body: { titulo: 'Rascunho' } });
  const dec = (await app.call('GET', `/api/studio/works/${w}/publicacao`, { tok: a.tok })).j.declaracao.versao;
  await app.call('POST', `/api/studio/works/${w}/publicacao`, { tok: a.tok, body: { acao: 'publicar', aceite: dec, meta: { titulo: 'Do Estúdio', sinopse: 's', faixa: 'L' }, docs: [c] } });
  const l = app.addUser({ role: 'leitor' });
  await app.call('PUT', '/api/reviews', { tok: l.tok, body: { autor: a.slug, obra: idFora, nota: 4, texto: 'Gostei bastante do livro.' } });

  const v = await app.call('GET', '/api/vitrine');
  assert.equal(v.s, 200);
  const titulos = v.j.livros.map((x) => x.titulo).sort();
  assert.deepEqual(titulos, ['Do Estúdio', 'Publicado Fora']);
  const fora = v.j.livros.find((x) => x.titulo === 'Publicado Fora');
  assert.equal(fora.autor.nome, 'Ana'); assert.equal(fora.faixa, '12'); assert.equal(fora.avaliacoes.total, 1);
  assert.ok(fora.no_site_em > 0);
  const est = v.j.livros.find((x) => x.tipo === 'estudio');
  assert.match(est.ler, /^ler\.html\?a=/);
});
