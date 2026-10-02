import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp } from './helpers.mjs';
import { norm, extractTags, extractLinks } from '../../src/studio.js';

const base = '/api/studio/works';

async function cenario() {
  const app = makeApp(); const a = app.addUser();
  const w = (await app.call('POST', base, { tok: a.tok, body: { titulo: 'Rio' } })).j.id;
  const arv = (await app.call('GET', `${base}/${w}`, { tok: a.tok })).j.itens;
  const ms = arv.find((i) => i.doc_tipo === 'manuscrito').id, pers = arv.find((i) => i.doc_tipo === 'personagens').id;
  const doc = async (pai, titulo, corpo, tipo = 'nota') => {
    const id = (await app.call('POST', `${base}/${w}/docs`, { tok: a.tok, body: { pai, titulo, doc_tipo: tipo } })).j.id;
    if (corpo) await app.call('PUT', `${base}/${w}/docs/${id}`, { tok: a.tok, body: { versao_base: 1, corpo } });
    return id;
  };
  const busca = async (qs, tok = a.tok, obra = w) => (await app.call('GET', `${base}/${obra}/search?${qs}`, { tok })).j.resultados;
  return { app, a, w, ms, pers, doc, busca };
}

test('normalizacao: sem acento e sem diferenca de caixa', () => {
  assert.equal(norm('Márcia AÇÃO Coração ¿Qué?'), 'marcia acao coracao ¿que?');
  assert.equal(norm(''), ''); assert.equal(norm(null), '');
});

test('hashtags no texto viram tags; "# Titulo" de Markdown nao', () => {
  assert.deepEqual(extractTags('Resolver #resolver depois. #Continuidade e (#pesquisar)\n# Título\n#1 nao\n\\#revisar'), ['resolver', 'continuidade', 'pesquisar', 'revisar']);
  assert.deepEqual(extractTags('sem tags aqui, e-mail a#b.com'), []);
});

test('links [[...]] sao extraidos (com e sem escape de Markdown)', () => {
  const l = extractLinks('Ver [[Kayla]] e [[Casa de Kayla|a casa]] e \\[\\[Max\\]\\] e [[kayla]] e [[ ]]');
  assert.deepEqual(l.map(([n]) => n), ['kayla', 'casa de kayla', 'max']);
});

test('busca acha por titulo e por texto, sem acento e sem caixa, com trecho', async () => {
  const { w, doc, busca } = await cenario();
  await doc(null, 'Márcia', 'A tia de Kayla guardava um segredo sobre a REPRESA.', 'personagem');
  await doc(null, 'Cap 1', 'Kayla caminhou até a represa antes do amanhecer. Nada de Márcia por perto.', 'capitulo');
  await doc(null, 'Cronologia', 'sem relação com o resto');
  let r = await busca('q=marcia');
  assert.equal(r.length, 2);
  assert.equal(r[0].titulo, 'Márcia', 'quem tem a busca no titulo vem primeiro');
  assert.equal(r[0].no_titulo, true);
  const cap = r.find((x) => x.titulo === 'Cap 1');
  assert.ok(cap.trecho.includes('Márcia'), 'trecho mostra o texto original com acento: ' + cap.trecho);
  assert.equal((await busca('q=REPRESA')).length, 2, 'caixa alta casa com qualquer caixa');
  assert.equal((await busca('q=Represa&tipo=capitulo')).length, 1, 'filtro por tipo');
  assert.equal((await busca('q=a')).length, 0, 'uma letra so nao busca');
  assert.equal((await busca('q=inexistente')).length, 0);
  assert.equal((await busca('q=50%25')).length, 0, '% e tratado como texto, nao como curinga');
  assert.equal((await busca('q=_')).length, 0);
  void w;
});

test('busca acompanha as edicoes e some quando o documento vai para a lixeira', async () => {
  const { app, a, w, doc, busca } = await cenario();
  const d = await doc(null, 'Nota', 'palavra-antiga aqui');
  assert.equal((await busca('q=antiga')).length, 1);
  await app.call('PUT', `${base}/${w}/docs/${d}`, { tok: a.tok, body: { versao_base: 2, corpo: 'agora é palavra-nova' } });
  assert.equal((await busca('q=antiga')).length, 0, 'texto antigo some do indice');
  assert.equal((await busca('q=nova')).length, 1);
  await app.call('PUT', `${base}/${w}/docs/${d}`, { tok: a.tok, body: { versao_base: 3, titulo: 'Zebra' } });
  assert.equal((await busca('q=zebra')).length, 1, 'renomear atualiza a busca');
  await app.call('DELETE', `${base}/${w}/docs/${d}`, { tok: a.tok });
  assert.equal((await busca('q=nova')).length, 0, 'na lixeira nao aparece');
  await app.call('POST', `${base}/${w}/docs/${d}/restore`, { tok: a.tok });
  assert.equal((await busca('q=nova')).length, 1, 'restaurado volta a aparecer');
  await app.call('DELETE', `${base}/${w}/docs/${d}`, { tok: a.tok });
  await app.call('DELETE', `${base}/${w}/docs/${d}?definitivo=1`, { tok: a.tok });
  assert.equal(app.db.prepare('SELECT COUNT(*) n FROM studio_search WHERE doc_id = ?').get(d).n, 0, 'apagar definitivo limpa o indice');
});

test('busca nunca atravessa obras nem usuarios', async () => {
  const { app, a, doc, w } = await cenario();
  await doc(null, 'Segredo da A', 'texto confidencial ULTRASSECRETO');
  const b = app.addUser();
  const wb = (await app.call('POST', base, { tok: b.tok, body: { titulo: 'Da B' } })).j.id;
  const docB = (await app.call('POST', `${base}/${wb}/docs`, { tok: b.tok, body: { titulo: 'B', doc_tipo: 'nota' } })).j.id;
  await app.call('PUT', `${base}/${wb}/docs/${docB}`, { tok: b.tok, body: { versao_base: 1, corpo: 'ultrassecreto tambem na B' } });
  assert.equal((await app.call('GET', `${base}/${w}/search?q=ultrassecreto`, { tok: b.tok })).s, 404, 'obra de outro: 404');
  const rb = (await app.call('GET', `${base}/${wb}/search?q=ultrassecreto`, { tok: b.tok })).j.resultados;
  assert.equal(rb.length, 1); assert.equal(rb[0].titulo, 'B', 'so os documentos da propria obra');
  void a;
});

test('tags manuais: validar, listar, filtrar, limite e normalizar', async () => {
  const { app, a, w, doc, busca } = await cenario();
  const d1 = await doc(null, 'D1', 'texto'), d2 = await doc(null, 'D2', 'outro');
  let r = await app.call('PUT', `${base}/${w}/docs/${d1}/tags`, { tok: a.tok, body: { tags: ['#Resolver', 'revisar', 'resolver', ' pesquisar '] } });
  assert.equal(r.s, 200); assert.deepEqual(r.j.tags, ['pesquisar', 'resolver', 'revisar'], 'minusculas, sem # e sem duplicatas');
  await app.call('PUT', `${base}/${w}/docs/${d2}/tags`, { tok: a.tok, body: { tags: ['resolver'] } });
  const obra = (await app.call('GET', `${base}/${w}`, { tok: a.tok })).j;
  assert.deepEqual(obra.tags[0], { tag: 'resolver', n: 2 }, 'contagem por tag, mais usada primeiro');
  assert.deepEqual(obra.itens.find((i) => i.id === d1).tags, ['pesquisar', 'resolver', 'revisar']);
  assert.deepEqual((await busca('tag=resolver')).map((x) => x.titulo).sort(), ['D1', 'D2'], 'filtra so por tag');
  assert.deepEqual((await busca('tag=revisar')).map((x) => x.titulo), ['D1']);
  assert.deepEqual((await busca('tag=resolver&q=outro')).map((x) => x.titulo), ['D2'], 'tag + texto');
  for (const ruim of ['com espaço', 'a'.repeat(31), 'ponto.final', '-comeco']) assert.equal((await app.call('PUT', `${base}/${w}/docs/${d1}/tags`, { tok: a.tok, body: { tags: [ruim] } })).s, 400, ruim);
  assert.equal((await app.call('PUT', `${base}/${w}/docs/${d1}/tags`, { tok: a.tok, body: { tags: Array.from({ length: 21 }, (_, i) => 't' + i) } })).s, 400, 'maximo 20');
  assert.equal((await app.call('PUT', `${base}/${w}/docs/${d1}/tags`, { tok: a.tok, body: { tags: [] } })).j.tags.length, 0, 'lista vazia remove');
  assert.equal((await app.call('PUT', `${base}/${w}/docs/${d1}/tags`, { tok: a.tok, body: { tags: 'x' } })).s, 400);
});

test('hashtags escritas no texto entram e saem sozinhas; tags manuais nao sao afetadas', async () => {
  const { app, a, w, doc } = await cenario();
  const d = await doc(null, 'Cena', 'Precisa #resolver isto. E #continuidade.');
  const tags = async () => (await app.call('GET', `${base}/${w}`, { tok: a.tok })).j.itens.find((i) => i.id === d).tags;
  assert.deepEqual(await tags(), ['continuidade', 'resolver']);
  await app.call('PUT', `${base}/${w}/docs/${d}/tags`, { tok: a.tok, body: { tags: ['manual'] } });
  await app.call('PUT', `${base}/${w}/docs/${d}`, { tok: a.tok, body: { versao_base: 2, corpo: 'Só #continuidade agora.' } });
  assert.deepEqual(await tags(), ['continuidade', 'manual'], '#resolver saiu do texto e saiu das tags; a manual ficou');
  await app.call('PUT', `${base}/${w}/docs/${d}/tags`, { tok: a.tok, body: { tags: [] } });
  assert.deepEqual(await tags(), ['continuidade'], 'remover as manuais nao remove as do texto');
});

test('tags: outro autor nao altera; pasta nao recebe tags; duplicar copia as manuais', async () => {
  const { app, a, w, doc, ms } = await cenario();
  const d = await doc(null, 'X', 'corpo');
  await app.call('PUT', `${base}/${w}/docs/${d}/tags`, { tok: a.tok, body: { tags: ['copiavel'] } });
  const b = app.addUser();
  assert.equal((await app.call('PUT', `${base}/${w}/docs/${d}/tags`, { tok: b.tok, body: { tags: ['invadido'] } })).s, 404);
  assert.equal((await app.call('PUT', `${base}/${w}/docs/${ms}/tags`, { tok: a.tok, body: { tags: ['x'] } })).s, 404, 'pasta');
  const cp = (await app.call('POST', `${base}/${w}/docs/${d}/duplicate`, { tok: a.tok })).j.id;
  const itens = (await app.call('GET', `${base}/${w}`, { tok: a.tok })).j.itens;
  assert.deepEqual(itens.find((i) => i.id === cp).tags, ['copiavel']);
  assert.equal((await app.call('GET', `${base}/${w}/search?q=corpo`, { tok: a.tok })).j.resultados.length, 2, 'a copia tambem e pesquisavel');
});

test('tags de documentos na lixeira nao aparecem no resumo', async () => {
  const { app, a, w, doc } = await cenario();
  const d = await doc(null, 'X', 'texto');
  await app.call('PUT', `${base}/${w}/docs/${d}/tags`, { tok: a.tok, body: { tags: ['fantasma'] } });
  await app.call('DELETE', `${base}/${w}/docs/${d}`, { tok: a.tok });
  assert.deepEqual((await app.call('GET', `${base}/${w}`, { tok: a.tok })).j.tags, []);
});

test('limite de tamanho do documento: 400 mil caracteres', async () => {
  const { app, a, w, doc } = await cenario();
  const d = await doc(null, 'Grande', '');
  assert.equal((await app.call('PUT', `${base}/${w}/docs/${d}`, { tok: a.tok, body: { versao_base: 1, corpo: 'a'.repeat(400000) } })).s, 200);
  assert.equal((await app.call('PUT', `${base}/${w}/docs/${d}`, { tok: a.tok, body: { versao_base: 2, corpo: 'a'.repeat(400001) } })).s, 413);
});
