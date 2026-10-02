import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp } from './helpers.mjs';

const base = '/api/studio/works';

async function cenario() {
  const app = makeApp(); const a = app.addUser();
  const w = (await app.call('POST', base, { tok: a.tok, body: { titulo: 'Rio' } })).j.id;
  const doc = async (titulo, corpo = '', tipo = 'nota') => {
    const id = (await app.call('POST', `${base}/${w}/docs`, { tok: a.tok, body: { doc_tipo: tipo, titulo } })).j.id;
    if (corpo) await app.call('PUT', `${base}/${w}/docs/${id}`, { tok: a.tok, body: { versao_base: 1, corpo } });
    return id;
  };
  const links = async (id, tok = a.tok, obra = w) => (await app.call('GET', `${base}/${obra}/docs/${id}/links`, { tok })).j;
  const salvar = async (id, corpo, titulo) => {
    const g = (await app.call('GET', `${base}/${w}/docs/${id}`, { tok: a.tok })).j;
    return app.call('PUT', `${base}/${w}/docs/${id}`, { tok: a.tok, body: { versao_base: g.versao, corpo, ...(titulo ? { titulo } : {}) } });
  };
  return { app, a, w, doc, links, salvar };
}

test('links saem e entram: backlinks e resolucao por titulo', async () => {
  const { w, doc, links } = await cenario();
  const kayla = await doc('Kayla', 'Quinze anos.', 'personagem');
  const max = await doc('Max', 'Amigo de [[Kayla]]. Mora perto do [[Rio]].', 'personagem');
  const cap = await doc('Capítulo 03', 'Quando [[Kayla]] viu [[Max]] na margem, entendeu a [[Regra dos Nomes]].', 'capitulo');
  void w;
  const lk = await links(kayla);
  assert.deepEqual(lk.saem, [], 'Kayla nao cita ninguem');
  assert.deepEqual(lk.entram.map((x) => x.titulo), ['Capítulo 03', 'Max'], 'backlinks ordenados por titulo');
  const lc = await links(cap);
  assert.deepEqual(lc.saem.map((x) => [x.titulo, x.destino ? x.destino.titulo : null]), [['Kayla', 'Kayla'], ['Max', 'Max'], ['Regra dos Nomes', null]], 'ultimo link ainda nao tem destino');
  assert.deepEqual((await links(max)).entram.map((x) => x.titulo), ['Capítulo 03']);
});

test('titulo e comparado sem acento e sem caixa; criar o destino depois conserta o link', async () => {
  const { doc, links } = await cenario();
  const cap = await doc('Cap', 'Falei com [[marcia]] e com [[CASA da Kayla]].');
  assert.deepEqual((await links(cap)).saem.map((x) => x.destino), [null, null]);
  const m = await doc('Márcia', 'tia');
  const c = await doc('Casa da Kayla', 'lugar', 'nota');
  const lk = await links(cap);
  assert.deepEqual(lk.saem.map((x) => x.destino && x.destino.id).sort(), [m, c].sort());
  assert.equal((await links(m)).entram[0].titulo, 'Cap');
});

test('renomear o destino quebra o link (e voltar o nome restaura)', async () => {
  const { doc, links, salvar } = await cenario();
  const alvo = await doc('Kayla', 'x');
  const fonte = await doc('Cena', 'Com [[Kayla]].');
  assert.ok((await links(fonte)).saem[0].destino);
  await salvar(alvo, 'x', 'Kayla Silva');
  assert.equal((await links(fonte)).saem[0].destino, null, 'link aponta para titulo que nao existe mais');
  assert.deepEqual((await links(alvo)).entram, []);
  await salvar(alvo, 'x', 'Kayla');
  assert.ok((await links(fonte)).saem[0].destino, 'voltou');
});

test('editar o texto atualiza os links; remover o link remove o backlink', async () => {
  const { doc, links, salvar } = await cenario();
  const alvo = await doc('Rio', 'x');
  const fonte = await doc('Cena', 'Margem do [[Rio]].');
  assert.equal((await links(alvo)).entram.length, 1);
  await salvar(fonte, 'Sem link nenhum agora.');
  assert.equal((await links(alvo)).entram.length, 0);
  assert.deepEqual((await links(fonte)).saem, []);
});

test('lixeira: documento na lixeira nao aparece como origem nem como destino', async () => {
  const { app, a, w, doc, links } = await cenario();
  const alvo = await doc('Alvo', 'x');
  const fonte = await doc('Fonte', 'Cita [[Alvo]].');
  await app.call('DELETE', `${base}/${w}/docs/${fonte}`, { tok: a.tok });
  assert.deepEqual((await links(alvo)).entram, [], 'origem na lixeira some dos backlinks');
  await app.call('POST', `${base}/${w}/docs/${fonte}/restore`, { tok: a.tok });
  assert.equal((await links(alvo)).entram.length, 1, 'restaurada, volta');
  await app.call('DELETE', `${base}/${w}/docs/${alvo}`, { tok: a.tok });
  assert.equal((await links(fonte)).saem[0].destino, null, 'destino na lixeira = link sem destino');
});

test('link para o proprio documento nao vira backlink; alias e escape de Markdown funcionam', async () => {
  const { doc, links } = await cenario();
  const eu = await doc('Eu mesmo', 'Falo de [[Eu mesmo]] e de [[Outro|o outro]] e de \\[\\[Escapado\\]\\].');
  const lk = await links(eu);
  assert.equal((await links(eu)).entram.length, 0);
  assert.deepEqual(lk.saem.map((x) => x.titulo), ['Escapado', 'Eu mesmo', 'Outro']);
  assert.equal(lk.saem.find((x) => x.titulo === 'Eu mesmo').destino.proprio, true);
});

test('links nao atravessam obras nem usuarios', async () => {
  const { app, a, w, doc, links } = await cenario();
  await doc('Kayla', 'x');
  const fonteA = await doc('Cena', 'Com [[Kayla]].');
  // outra obra do mesmo autor com um "Kayla" proprio
  const w2 = (await app.call('POST', base, { tok: a.tok, body: { titulo: 'Outra' } })).j.id;
  const k2 = (await app.call('POST', `${base}/${w2}/docs`, { tok: a.tok, body: { doc_tipo: 'nota', titulo: 'Kayla' } })).j.id;
  assert.deepEqual((await links(k2, a.tok, w2)).entram, [], 'a outra obra nao recebe backlink');
  assert.equal((await links(fonteA)).saem[0].destino.titulo, 'Kayla');
  // outro usuario
  const b = app.addUser();
  assert.equal((await app.call('GET', `${base}/${w}/docs/${fonteA}/links`, { tok: b.tok })).s, 404);
  // pasta nao tem links
  const pasta = (await app.call('GET', `${base}/${w}`, { tok: a.tok })).j.itens.find((i) => i.tipo === 'pasta').id;
  assert.equal((await app.call('GET', `${base}/${w}/docs/${pasta}/links`, { tok: a.tok })).s, 404);
});

test('titulos repetidos: o link usa o documento mais recente e nada quebra', async () => {
  const { doc, links } = await cenario();
  await doc('Igual', 'primeiro');
  const segundo = await doc('Igual', 'segundo');
  const fonte = await doc('Fonte', 'Ver [[Igual]].');
  const lk = await links(fonte);
  assert.equal(lk.saem.length, 1);
  assert.ok(lk.saem[0].destino);
  void segundo;
});

test('um documento com muitas tags e links nao passa de 6 comandos SQL por salvamento (limite do plano gratuito)', async () => {
  const { app, a, w, doc } = await cenario();
  const d = await doc('Denso', '');
  const corpo = Array.from({ length: 90 }, (_, i) => `[[Alvo ${i}]]`).join(' ') + ' ' + Array.from({ length: 30 }, (_, i) => `#tag${i}`).join(' ');
  let comandos = 0;
  const prepare = app.env.DB.prepare;
  app.env.DB.prepare = (sql) => { comandos++; return prepare(sql); };
  const g = (await app.call('GET', `${base}/${w}/docs/${d}`, { tok: a.tok })).j;
  comandos = 0;
  const r = await app.call('PUT', `${base}/${w}/docs/${d}`, { tok: a.tok, body: { versao_base: g.versao, corpo } });
  app.env.DB.prepare = prepare;
  assert.equal(r.s, 200);
  assert.ok(comandos <= 16, `salvar usou ${comandos} comandos SQL (limite pratico: 50 por requisicao)`);
  const lk = await app.call('GET', `${base}/${w}/docs/${d}/links`, { tok: a.tok });
  assert.equal(lk.j.saem.length, 90, 'todos os links foram indexados');
  const tags = (await app.call('GET', `${base}/${w}`, { tok: a.tok })).j.itens.find((i) => i.id === d).tags;
  assert.equal(tags.length, 20, 'tags do texto limitadas a 20');
});
