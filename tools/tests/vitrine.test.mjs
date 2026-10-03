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

test('vitrine: popularidade por semana, mes e ano (visitas + 3 x favoritos + 2 x avaliacoes)', async () => {
  const app = makeApp();
  const a = app.addUser({ nome: 'Ana' });
  const r = await app.call('PUT', '/api/profile', { tok: a.tok, body: { data: { nome: 'Ana', links: [], secoes: [], obras: [
    { titulo: 'Quente', status: 'Publicado' }, { titulo: 'Antigo', status: 'Publicado' }, { titulo: 'Quieto', status: 'Publicado' },
  ] } } });
  const [quente, antigo] = r.j.data.obras.map((o) => o.id);
  const l = app.addUser({ role: 'leitor' });
  await app.call('POST', `/api/livro/${a.slug}/${quente}/visita`, { ip: '2.2.2.2' });
  await app.call('POST', `/api/livro/${a.slug}/${quente}/visita`, { ip: '3.3.3.3' });
  await app.call('POST', `/api/livro/${a.slug}/${quente}/favorito`, { tok: l.tok });
  await app.call('PUT', '/api/reviews', { tok: l.tok, body: { autor: a.slug, obra: quente, nota: 5, texto: 'Muito bom mesmo, recomendo.' } });
  // movimento antigo: 20 dias atras (fora da semana) e 200 dias atras (so no ano)
  const dia = Math.floor(Date.now() / 86400000);
  app.db.prepare('INSERT INTO book_views (obra_id, visitante, dia) VALUES (?, ?, ?)').run(antigo, 'v1', dia - 20);
  app.db.prepare('INSERT INTO book_views (obra_id, visitante, dia) VALUES (?, ?, ?)').run(antigo, 'v2', dia - 200);
  app.db.prepare('INSERT INTO book_views (obra_id, visitante, dia) VALUES (?, ?, ?)').run(antigo, 'v3', dia - 400);

  const v = (await app.call('GET', '/api/vitrine')).j.livros;
  const pop = (t) => v.find((x) => x.titulo === t).popular;
  assert.deepEqual(pop('Quente'), { semana: 7, mes: 7, ano: 7 }, '2 visitas + 3 do favorito + 2 da avaliacao');
  assert.deepEqual(pop('Antigo'), { semana: 0, mes: 1, ano: 2 }, 'o de 400 dias nao conta');
  assert.deepEqual(pop('Quieto'), { semana: 0, mes: 0, ano: 0 });
});
