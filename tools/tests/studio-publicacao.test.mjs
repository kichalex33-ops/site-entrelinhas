import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp } from './helpers.mjs';

const base = '/api/studio/works';

async function cenario(env = { ESTUDIO_PUBLICACAO: 'on' }) {
  const app = makeApp(env); const a = app.addUser({ nome: 'Ana Autora' });
  const w = (await app.call('POST', base, { tok: a.tok, body: { titulo: 'O Rio' } })).j.id;
  const doc = async (titulo, corpo, tipo = 'capitulo') => {
    const id = (await app.call('POST', `${base}/${w}/docs`, { tok: a.tok, body: { doc_tipo: tipo, titulo, corpo } })).j.id;
    return id;
  };
  const c1 = await doc('Capítulo 1', 'A margem do [[Rio|rio]] estava fria. #revisar\n\nSegundo parágrafo.');
  const c2 = await doc('Capítulo 2', 'Kayla voltou.');
  const nota = await doc('Ideia secreta', 'Ninguém pode ler isto.', 'nota');
  const dec = (await app.call('GET', `${base}/${w}/publicacao`, { tok: a.tok })).j.declaracao.versao;
  const pub = (body, tok = a.tok, obra = w) => app.call('POST', `${base}/${obra}/publicacao`, { tok, body: { acao: 'publicar', aceite: dec, meta: { titulo: 'O Rio', sinopse: 'Uma menina e um rio.', genero: 'Fantasia', faixa: '12' }, docs: [c1, c2], ...body } });
  return { app, a, w, c1, c2, nota, dec, pub };
}

test('publicar: copia os capitulos, aparece na leitura publica e no perfil', async () => {
  const { app, a, w, c1, pub } = await cenario();
  const r = await pub({});
  assert.equal(r.s, 200, JSON.stringify(r.j));
  assert.equal(r.j.status, 'publicado');
  assert.equal(r.j.slug, 'o-rio');
  assert.equal(r.j.capitulos, 2);

  const obra = await app.call('GET', `/api/leitura/${a.slug}/o-rio`);
  assert.equal(obra.s, 200);
  assert.equal(obra.j.titulo, 'O Rio');
  assert.equal(obra.j.autor.nome, 'Ana Autora');
  assert.deepEqual(obra.j.capitulos.map((c) => c.titulo), ['Capítulo 1', 'Capítulo 2']);

  const cap = await app.call('GET', `/api/leitura/${a.slug}/o-rio/1`);
  assert.equal(cap.j.proximo, 2); assert.equal(cap.j.anterior, null);
  assert.ok(cap.j.corpo.includes('A margem do rio estava fria.'), 'link interno vira so o texto: ' + cap.j.corpo);
  assert.ok(!cap.j.corpo.includes('#revisar') && !cap.j.corpo.includes('[['), 'nada privado no texto publico');

  const bib = await app.call('GET', '/api/biblioteca');
  assert.equal(bib.j.obras.length, 1); assert.equal(bib.j.obras[0].id, w);

  const perfil = await app.call('GET', `/api/profile/${a.slug}`);
  assert.equal(perfil.j.publicadas.length, 1); assert.equal(perfil.j.publicadas[0].capitulos, 2);

  // listagem do Estudio mostra o status novo
  const lista = (await app.call('GET', base, { tok: a.tok })).j.obras;
  assert.equal(lista[0].status, 'publicado');
  void c1;
});

test('salvar nao e publicar: editar o rascunho nao muda o que esta no ar, so ao atualizar', async () => {
  const { app, a, w, c1, pub } = await cenario();
  await pub({});
  const g = (await app.call('GET', `${base}/${w}/docs/${c1}`, { tok: a.tok })).j;
  await app.call('PUT', `${base}/${w}/docs/${c1}`, { tok: a.tok, body: { versao_base: g.versao, corpo: 'Texto novo do rascunho.' } });
  assert.ok((await app.call('GET', `/api/leitura/${a.slug}/o-rio/1`)).j.corpo.includes('margem'), 'continua a versao publicada');
  const r = await pub({});
  assert.equal(r.j.status, 'atualizado'); assert.equal(r.j.versao, 2); assert.equal(r.j.slug, 'o-rio', 'endereco estavel');
  assert.equal((await app.call('GET', `/api/leitura/${a.slug}/o-rio/1`)).j.corpo, 'Texto novo do rascunho.');
});

test('so os documentos escolhidos, na ordem escolhida; nota privada nunca entra sem ser escolhida', async () => {
  const { app, a, c1, c2, nota, pub } = await cenario();
  await pub({ docs: [c2, c1] });
  const obra = (await app.call('GET', `/api/leitura/${a.slug}/o-rio`)).j;
  assert.deepEqual(obra.capitulos.map((c) => c.titulo), ['Capítulo 2', 'Capítulo 1']);
  assert.ok(!JSON.stringify(obra).includes('Ideia secreta'));
  void nota;
});

test('validacoes: declaracao, sinopse, capitulos de outra obra, repetidos e capa alheia', async () => {
  const { app, a, w, c1, dec, pub } = await cenario();
  assert.equal((await pub({ aceite: undefined })).s, 400, 'sem aceite');
  assert.equal((await pub({ aceite: dec + 1 })).s, 400, 'aceite de versao errada');
  assert.equal((await pub({ meta: { titulo: 'X', sinopse: '' } })).s, 400, 'sem sinopse');
  const semFaixa = await pub({ meta: { titulo: 'O Rio', sinopse: 's' } });
  assert.equal(semFaixa.s, 400, 'sem faixa etaria'); assert.match(semFaixa.j.erro, /faixa etária/);
  assert.equal((await pub({ meta: { titulo: 'O Rio', sinopse: 's', faixa: '13' } })).s, 400, 'faixa fora da lista');
  assert.equal((await pub({ docs: [] })).s, 400, 'sem capitulos');
  assert.equal((await pub({ docs: [c1, c1] })).s, 400, 'repetido');
  const outra = (await app.call('POST', base, { tok: a.tok, body: { titulo: 'Outra' } })).j.id;
  const alheio = (await app.call('POST', `${base}/${outra}/docs`, { tok: a.tok, body: { doc_tipo: 'capitulo', titulo: 'Fora', corpo: 'x' } })).j.id;
  assert.equal((await pub({ docs: [c1, alheio] })).s, 409, 'documento de outra obra');
  const b = app.addUser();
  app.db.prepare('INSERT INTO images (id, user_id, mime, data, created_at) VALUES (?, ?, ?, ?, ?)').run('ab'.repeat(12), b.id, 'image/png', new Uint8Array([1]), 1);
  assert.equal((await pub({ meta: { titulo: 'O Rio', sinopse: 's', faixa: '12', capa: 'ab'.repeat(12) } })).s, 400, 'capa de outra pessoa');
  app.db.prepare('INSERT INTO images (id, user_id, mime, data, created_at) VALUES (?, ?, ?, ?, ?)').run('cd'.repeat(12), a.id, 'image/png', new Uint8Array([1]), 1);
  const ok = await pub({ meta: { titulo: 'O Rio', sinopse: 's', faixa: '12', capa: 'cd'.repeat(12) } });
  assert.equal(ok.s, 200);
  assert.equal((await app.call('GET', `/api/leitura/${a.slug}/o-rio`)).j.capa, 'cd'.repeat(12));
  // nada publicado nas tentativas que falharam: o aceite so foi gravado uma vez
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM studio_acceptances WHERE work_id = ?').get(w).n, 1);
});

test('aceite registrado com versao da declaracao, acao e versao da publicacao', async () => {
  const { app, w, dec, pub } = await cenario();
  await pub({}); await pub({});
  const rows = app.db.prepare('SELECT declaration_version, acao, pub_version FROM studio_acceptances WHERE work_id = ? ORDER BY id').all(w);
  assert.deepEqual(rows.map((r) => [r.declaration_version, r.acao, r.pub_version]), [[dec, 'publicar', 1], [dec, 'atualizar', 2]]);
});

test('outro autor nao publica, nao despublica e nem ve a publicacao de obra alheia', async () => {
  const { app, w, pub } = await cenario();
  const b = app.addUser();
  assert.equal((await pub({}, b.tok)).s, 404);
  assert.equal((await app.call('GET', `${base}/${w}/publicacao`, { tok: b.tok })).s, 404);
  await pub({});
  assert.equal((await app.call('DELETE', `${base}/${w}/publicacao`, { tok: b.tok })).s, 404);
  const leitor = app.addUser({ role: 'leitor' });
  assert.equal((await app.call('GET', `${base}/${w}/publicacao`, { tok: leitor.tok })).s, 403);
  assert.equal((await app.call('GET', `${base}/${w}/publicacao`)).s, 401);
});

test('agendar: invisivel antes da hora, visivel depois; nao agenda o que ja esta no ar', async () => {
  const { app, a, w, pub } = await cenario();
  const t = Math.floor(Date.now() / 1000);
  assert.equal((await pub({ acao: 'agendar', quando: t - 10 })).s, 400, 'passado');
  assert.equal((await pub({ acao: 'agendar', quando: t + 400 * 86400 })).s, 400, 'longe demais');
  const r = await pub({ acao: 'agendar', quando: t + 3600 });
  assert.equal(r.j.status, 'agendado');
  assert.equal((await app.call('GET', `/api/leitura/${a.slug}/o-rio`)).s, 404, 'ainda nao chegou a hora');
  assert.equal((await app.call('GET', '/api/biblioteca')).j.obras.length, 0);
  app.db.prepare('UPDATE studio_works SET scheduled_at = ? WHERE id = ?').run(t - 1, w); // a hora chegou
  assert.equal((await app.call('GET', `/api/leitura/${a.slug}/o-rio`)).s, 200);
  assert.equal((await app.call('GET', base, { tok: a.tok })).j.obras[0].status, 'publicado', 'Estudio mostra como publicada');
  assert.equal((await pub({ acao: 'agendar', quando: t + 7200 })).s, 409);
});

test('despublicar tira do ar, guarda o endereco e libera a edicao de status', async () => {
  const { app, a, w, pub } = await cenario();
  await pub({});
  const d = await app.call('DELETE', `${base}/${w}/publicacao`, { tok: a.tok });
  assert.equal(d.j.status, 'em_revisao');
  assert.equal((await app.call('GET', `/api/leitura/${a.slug}/o-rio`)).s, 404);
  assert.equal((await app.call('GET', `/api/leitura/${a.slug}/o-rio/1`)).s, 404);
  assert.equal((await app.call('GET', `/api/profile/${a.slug}`)).j.publicadas.length, 0);
  assert.equal((await app.call('DELETE', `${base}/${w}/publicacao`, { tok: a.tok })).s, 409, 'ja esta fora do ar');
  assert.equal((await app.call('PATCH', `${base}/${w}`, { tok: a.tok, body: { status: 'rascunho' } })).s, 200);
  const r = await pub({ meta: { titulo: 'Outro título', sinopse: 's', faixa: '12' } });
  assert.equal(r.j.slug, 'o-rio', 'volta no mesmo endereco');
});

test('obra excluida sai do ar; slugs nao colidem entre obras do mesmo autor', async () => {
  const { app, a, w, pub } = await cenario();
  await pub({});
  const w2 = (await app.call('POST', base, { tok: a.tok, body: { titulo: 'O Rio' } })).j.id;
  const c = (await app.call('POST', `${base}/${w2}/docs`, { tok: a.tok, body: { doc_tipo: 'capitulo', titulo: 'Um', corpo: 'x' } })).j.id;
  const r2 = await pub({ docs: [c] }, a.tok, w2);
  assert.equal(r2.j.slug, 'o-rio-2');
  await app.call('DELETE', `${base}/${w}`, { tok: a.tok });
  assert.equal((await app.call('GET', `/api/leitura/${a.slug}/o-rio`)).s, 404);
  assert.equal((await app.call('GET', `/api/leitura/${a.slug}/o-rio-2`)).s, 200);
});

test('reviews funcionam em obra publicada no Estudio (e nao em rascunho)', async () => {
  const { app, a, w, pub } = await cenario();
  const leitor = app.addUser({ role: 'leitor' });
  const rev = () => app.call('PUT', '/api/reviews', { tok: leitor.tok, body: { autor: a.slug, obra: w, nota: 5, texto: 'Muito bom mesmo, recomendo.' } });
  assert.equal((await rev()).s, 404, 'rascunho nao recebe review');
  await pub({});
  assert.equal((await rev()).s, 200);
  assert.equal((await app.call('GET', `/api/profile/${a.slug}`)).j.publicadas[0].reviews.total, 1);
});

test('chave desligada: nao publica e a leitura publica nao existe', async () => {
  const { app, a, w, pub } = await cenario({ ESTUDIO_PUBLICACAO: 'off' });
  const g = (await app.call('GET', `${base}/${w}/publicacao`, { tok: a.tok })).j;
  assert.equal(g.ligada, false);
  assert.equal((await pub({})).s, 403);
  assert.equal((await app.call('GET', '/api/biblioteca')).s, 404);
  assert.deepEqual((await app.call('GET', `/api/profile/${a.slug}`)).j.publicadas, []);
});

test('salvar o perfil nao apaga a capa usada no Estudio', async () => {
  const { app, a, pub } = await cenario();
  app.db.prepare('INSERT INTO images (id, user_id, mime, data, created_at) VALUES (?, ?, ?, ?, ?)').run('ef'.repeat(12), a.id, 'image/png', new Uint8Array([1]), 1);
  await pub({ meta: { titulo: 'O Rio', sinopse: 's', faixa: '12', capa: 'ef'.repeat(12) } });
  await app.call('PUT', '/api/profile', { tok: a.tok, body: { data: { nome: 'Ana Autora', obras: [] } } });
  assert.ok(app.db.prepare('SELECT 1 FROM images WHERE id = ?').get('ef'.repeat(12)));
});
