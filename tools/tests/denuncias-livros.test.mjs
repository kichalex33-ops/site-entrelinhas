import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp } from './helpers.mjs';

async function cenario() {
  const app = makeApp({ ESTUDIO_PUBLICACAO: 'on' });
  const autora = app.addUser({ nome: 'Autora' });
  const r = await app.call('PUT', '/api/profile', { tok: autora.tok, body: { data: { nome: 'Autora', links: [], secoes: [], obras: [{ titulo: 'Livro Suspeito', faixa: '12' }] } } });
  const mod = app.addUser({ mod: true });
  const den = (tok, body) => app.call('POST', `/api/livro/${autora.slug}/${r.j.data.obras[0].id}/denuncia`, { tok, body });
  return { app, autora, mod, obra: r.j.data.obras[0].id, den };
}

test('simulacao: denuncias de pirataria, plagio e IA chegam a moderacao; o autor ve so os motivos', async () => {
  const { app, autora, mod, obra, den } = await cenario();
  const l1 = app.addUser({ role: 'leitor', nome: 'Leitor Um' });
  const l2 = app.addUser({ role: 'leitor', nome: 'Leitor Dois' });
  const a3 = app.addUser({ nome: 'Outro Autor' });

  assert.equal((await den(l1.tok, { motivo: 'pirataria', detalhe: 'curto' })).s, 400, 'pirataria exige descricao');
  let r = await den(l1.tok, { motivo: 'pirataria', detalhe: 'É o livro X da editora Y, copiado palavra por palavra.', link: 'https://editora.example/x' });
  assert.equal(r.s, 200, JSON.stringify(r.j));
  assert.equal((await den(l2.tok, { motivo: 'plagio', detalhe: 'O capítulo 3 é igual a um conto publicado em 2019.' })).s, 200);
  assert.equal((await den(a3.tok, { motivo: 'ia' })).s, 200, 'IA nao exige descricao');
  assert.equal((await den(l1.tok, { motivo: 'ia' })).s, 409, 'uma denuncia por pessoa');
  assert.equal((await den(autora.tok, { motivo: 'spam' })).s, 403, 'nao denuncia o proprio livro');
  assert.equal((await den(undefined, { motivo: 'spam' })).s, 401);
  assert.equal((await den(l2.tok, { motivo: 'inventado' })).s, 400);
  assert.equal((await den(l1.tok, { motivo: 'outro', detalhe: 'Link quebrado de teste.', link: 'javascript:alert(1)' })).s, 400, 'link invalido');

  // moderacao recebe tudo, com quem denunciou e os detalhes
  const lista = await app.call('GET', '/api/admin/denuncias-livros', { tok: mod.tok });
  assert.equal(lista.s, 200);
  assert.deepEqual(lista.j.map((d) => d.motivo).sort(), ['ia', 'pirataria', 'plagio']);
  assert.ok(lista.j.find((d) => d.motivo === 'pirataria').link.startsWith('https://'));
  assert.equal((await app.call('GET', '/api/admin/denuncias-livros', { tok: l1.tok })).s, 403);

  // autor: ve motivos e quantidade na pagina do proprio livro, sem saber quem
  const pg = await app.call('GET', `/api/livro/${autora.slug}/${obra}`, { tok: autora.tok });
  assert.deepEqual(pg.j.denuncias.map((d) => d.motivo).sort(), ['ia', 'pirataria', 'plagio']);
  assert.ok(!JSON.stringify(pg.j.denuncias).includes('Leitor'), 'nao revela quem denunciou');
  assert.equal((await app.call('GET', `/api/livro/${autora.slug}/${obra}`, { tok: l1.tok })).j.denuncias, undefined, 'outros nao veem');

  // decisao do moderador tira da fila e do aviso ao autor
  const pir = lista.j.find((d) => d.motivo === 'pirataria');
  assert.equal((await app.call('POST', `/api/admin/denuncias-livros/${pir.id}`, { tok: mod.tok, body: { acao: 'resolver', nota: 'Autor removeu o livro.' } })).s, 200);
  assert.equal((await app.call('POST', `/api/admin/denuncias-livros/${pir.id}`, { tok: l1.tok, body: { acao: 'arquivar' } })).s, 403);
  const abertas = (await app.call('GET', '/api/admin/denuncias-livros', { tok: mod.tok })).j;
  assert.equal(abertas.length, 2);
  const todas = (await app.call('GET', '/api/admin/denuncias-livros?todas=1', { tok: mod.tok })).j;
  assert.equal(todas.find((d) => d.id === pir.id).status, 'resolvida');
  assert.equal((await app.call('GET', `/api/livro/${autora.slug}/${obra}`, { tok: autora.tok })).j.denuncias.length, 2);
});

test('denuncia so vale para livro existente', async () => {
  const { app, autora } = await cenario();
  const l = app.addUser({ role: 'leitor' });
  assert.equal((await app.call('POST', `/api/livro/${autora.slug}/aaaaaaaaaaaa/denuncia`, { tok: l.tok, body: { motivo: 'ia' } })).s, 404);
});

test('direitos autorais: "publicacao sem autorizacao" exige descricao; o painel mostra titulo, autor, motivo, quem e quando', async () => {
  const { app, autora, mod, obra, den } = await cenario();
  const l = app.addUser({ role: 'leitor', nome: 'Titular' });
  assert.equal((await den(l.tok, { motivo: 'sem_autorizacao' })).s, 400, 'precisa dizer de quem sao os direitos');
  assert.equal((await den(l.tok, { motivo: 'sem_autorizacao', detalhe: 'Sou a tradutora; esta traducao e minha e nao autorizei.' })).s, 200);
  const painel = (await app.call('GET', '/api/admin/denuncias-livros', { tok: mod.tok })).j;
  const d = painel.find((x) => x.motivo === 'sem_autorizacao');
  assert.equal(d.titulo, 'Livro Suspeito'); assert.equal(d.autor_slug, autora.slug); assert.equal(d.obra_id, obra);
  assert.equal(d.rotulo, 'Publicação sem autorização do titular dos direitos');
  assert.equal(d.quem, 'Titular'); assert.ok(d.created_at > 0); assert.equal(d.status, 'aberta');
  // a autora ve o motivo, nunca quem denunciou
  const livro = (await app.call('GET', `/api/livro/${autora.slug}/${obra}`, { tok: autora.tok })).j;
  assert.ok(!JSON.stringify(livro).includes('Titular'), 'nome de quem denunciou nao vaza para a autora');
});

test('avaliacoes denunciadas chegam ao painel; ocultar tira do ar; manter arquiva; quem escreveu nao ve quem denunciou', async () => {
  const { app, autora, mod, obra } = await cenario();
  const escritor = app.addUser({ role: 'leitor', nome: 'Rui' });
  const d1 = app.addUser({ role: 'leitor', nome: 'Denunciante Um' });
  const d2 = app.addUser({ role: 'leitor', nome: 'Denunciante Dois' });
  await app.call('PUT', '/api/reviews', { tok: escritor.tok, body: { autor: autora.slug, obra, nota: 1, texto: 'Texto ofensivo de teste aqui.' } });
  const rid = (await app.call('GET', `/api/reviews?autor=${autora.slug}&obra=${obra}`)).j.reviews[0].id;
  assert.equal((await app.call('POST', `/api/reviews/${rid}/denunciar`, { tok: d1.tok, body: { motivo: 'ofensivo' } })).s, 200);
  assert.equal((await app.call('POST', `/api/reviews/${rid}/denunciar`, { tok: d2.tok, body: { motivo: 'spam' } })).s, 200);

  assert.equal((await app.call('GET', '/api/admin/denuncias-avaliacoes', { tok: d1.tok })).s, 403, 'so moderador');
  let painel = (await app.call('GET', '/api/admin/denuncias-avaliacoes', { tok: mod.tok })).j;
  assert.equal(painel.length, 1);
  assert.equal(painel[0].titulo, 'Livro Suspeito'); assert.equal(painel[0].escreveu, 'Rui');
  assert.deepEqual(painel[0].denuncias.map((d) => d.quem).sort(), ['Denunciante Dois', 'Denunciante Um']);
  const publico = (await app.call('GET', `/api/reviews?autor=${autora.slug}&obra=${obra}`, { tok: escritor.tok })).j;
  assert.ok(!JSON.stringify(publico).includes('Denunciante'), 'quem escreveu nao ve quem denunciou');

  assert.equal((await app.call('POST', `/api/admin/denuncias-avaliacoes/${rid}`, { tok: mod.tok, body: { acao: 'apagar' } })).s, 400);
  assert.equal((await app.call('POST', `/api/admin/denuncias-avaliacoes/${rid}`, { tok: mod.tok, body: { acao: 'ocultar' } })).j.oculta, true);
  assert.equal((await app.call('GET', `/api/reviews?autor=${autora.slug}&obra=${obra}`)).j.reviews.length, 0, 'saiu do ar');
  assert.equal((await app.call('GET', '/api/admin/denuncias-avaliacoes', { tok: mod.tok })).j.length, 0, 'nada aberto');
  painel = (await app.call('GET', '/api/admin/denuncias-avaliacoes?todas=1', { tok: mod.tok })).j;
  assert.ok(painel[0].oculta); assert.ok(painel[0].denuncias.every((d) => d.status === 'ocultada'));

  // manter: a avaliacao volta e as denuncias ficam arquivadas
  assert.equal((await app.call('POST', `/api/admin/denuncias-avaliacoes/${rid}`, { tok: mod.tok, body: { acao: 'manter' } })).j.oculta, false);
  assert.equal((await app.call('GET', `/api/reviews?autor=${autora.slug}&obra=${obra}`)).j.reviews.length, 1);
});
