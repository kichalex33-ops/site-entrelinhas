import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp } from './helpers.mjs';

const base = '/api/studio/works';

async function novaObra(app, tok, titulo = 'O Que o Rio Esqueceu', tipo = 'texto') {
  const r = await app.call('POST', base, { tok, body: { titulo, tipo } });
  assert.equal(r.s, 201);
  const w = await app.call('GET', `${base}/${r.j.id}`, { tok });
  return { id: r.j.id, itens: w.j.itens, obra: w.j.obra };
}
const pasta = (w, tipo) => w.itens.find((i) => i.doc_tipo === tipo && i.tipo === 'pasta');

test('criar obra gera as pastas padrao e a listagem nao traz texto', async () => {
  const app = makeApp(); const a = app.addUser();
  const w = await novaObra(app, a.tok);
  assert.equal(w.obra.status, 'rascunho');
  assert.deepEqual(w.itens.filter((i) => i.tipo === 'pasta').map((i) => i.titulo),
    ['Manuscrito', 'Personagens', 'Mundo', 'Pesquisa', 'Ideias', 'Cenas descartadas']);
  assert.ok(w.itens.every((i) => i.corpo === undefined), 'a arvore nao carrega o corpo dos documentos');
  const lista = await app.call('GET', base, { tok: a.tok });
  assert.equal(lista.j.obras.length, 1);
  assert.equal(lista.j.obras[0].titulo, 'O Que o Rio Esqueceu');
});

test('obra de HQ cria a estrutura propria e titulo vazio e recusado', async () => {
  const app = makeApp(); const a = app.addUser();
  const w = await novaObra(app, a.tok, 'Minha HQ', 'hq');
  assert.deepEqual(w.itens.map((i) => i.titulo), ['Roteiro', 'Personagens', 'Cenários', 'Referências', 'Notas']);
  assert.equal((await app.call('POST', base, { tok: a.tok, body: { titulo: '   ' } })).s, 400);
});

test('criar capitulo, escrever, reabrir: o conteudo volta exatamente igual (texto longo e acentos)', async () => {
  const app = makeApp(); const a = app.addUser();
  const w = await novaObra(app, a.tok);
  const ms = pasta(w, 'manuscrito');
  const c = await app.call('POST', `${base}/${w.id}/docs`, { tok: a.tok, body: { pai: ms.id, doc_tipo: 'capitulo', titulo: 'Capítulo 01' } });
  assert.equal(c.s, 201); assert.equal(c.j.versao, 1);
  const longo = ('Kayla olhou o rio, “não esqueça”.\n\n— Márcia disse: ação, coração, ¿qué?\n\n').repeat(8000); // ~500 mil caracteres
  const p = await app.call('PUT', `${base}/${w.id}/docs/${c.j.id}`, { tok: a.tok, body: { versao_base: 1, corpo: longo } });
  assert.equal(p.s, 200); assert.equal(p.j.versao, 2);
  assert.ok(p.j.palavras > 40000);
  const g = await app.call('GET', `${base}/${w.id}/docs/${c.j.id}`, { tok: a.tok });
  assert.equal(g.j.corpo, longo, 'texto idêntico ao salvo');
  assert.equal(g.j.titulo, 'Capítulo 01');
  assert.equal(g.j.pai, ms.id);
});

test('autosave sem mudanca nao incrementa a versao', async () => {
  const app = makeApp(); const a = app.addUser();
  const w = await novaObra(app, a.tok);
  const c = (await app.call('POST', `${base}/${w.id}/docs`, { tok: a.tok, body: { titulo: 'Nota' } })).j;
  await app.call('PUT', `${base}/${w.id}/docs/${c.id}`, { tok: a.tok, body: { versao_base: 1, corpo: 'abc' } });
  const igual = await app.call('PUT', `${base}/${w.id}/docs/${c.id}`, { tok: a.tok, body: { versao_base: 2, corpo: 'abc' } });
  assert.equal(igual.j.versao, 2); assert.equal(igual.j.semMudanca, true);
});

test('conflito de edicao: 409 devolve a versao do servidor e nada e sobrescrito', async () => {
  const app = makeApp(); const a = app.addUser();
  const w = await novaObra(app, a.tok);
  const c = (await app.call('POST', `${base}/${w.id}/docs`, { tok: a.tok, body: { titulo: 'Cap', doc_tipo: 'capitulo' } })).j;
  await app.call('PUT', `${base}/${w.id}/docs/${c.id}`, { tok: a.tok, body: { versao_base: 1, corpo: 'versão do aparelho A' } });
  // aparelho B ainda esta na versao 1 e tenta salvar
  const b = await app.call('PUT', `${base}/${w.id}/docs/${c.id}`, { tok: a.tok, body: { versao_base: 1, corpo: 'versão do aparelho B' } });
  assert.equal(b.s, 409);
  assert.equal(b.j.atual.corpo, 'versão do aparelho A');
  assert.equal(b.j.atual.versao, 2);
  assert.equal((await app.call('GET', `${base}/${w.id}/docs/${c.id}`, { tok: a.tok })).j.corpo, 'versão do aparelho A', 'servidor intacto');
  const ok = await app.call('PUT', `${base}/${w.id}/docs/${c.id}`, { tok: a.tok, body: { versao_base: 2, corpo: 'versão do aparelho B, mesclada' } });
  assert.equal(ok.s, 200);
  assert.equal((await app.call('PUT', `${base}/${w.id}/docs/${c.id}`, { tok: a.tok, body: { corpo: 'sem base' } })).s, 400, 'versao base e obrigatoria');
});

test('snapshots: o primeiro e criado, os seguintes so depois de 10 minutos, com poda', async () => {
  const app = makeApp(); const a = app.addUser();
  const w = await novaObra(app, a.tok);
  const c = (await app.call('POST', `${base}/${w.id}/docs`, { tok: a.tok, body: { titulo: 'Cap' } })).j;
  const n = () => app.db.prepare('SELECT COUNT(*) n FROM studio_versions WHERE doc_id = ?').get(c.id).n;
  await app.call('PUT', `${base}/${w.id}/docs/${c.id}`, { tok: a.tok, body: { versao_base: 1, corpo: 'um' } });
  assert.equal(n(), 1);
  await app.call('PUT', `${base}/${w.id}/docs/${c.id}`, { tok: a.tok, body: { versao_base: 2, corpo: 'um dois' } });
  assert.equal(n(), 1, 'dentro de 10 min nao cria outro');
  app.db.prepare('UPDATE studio_versions SET created_at = created_at - 700 WHERE doc_id = ?').run(c.id);
  await app.call('PUT', `${base}/${w.id}/docs/${c.id}`, { tok: a.tok, body: { versao_base: 3, corpo: 'um dois tres' } });
  assert.equal(n(), 2);
  for (let i = 0; i < 60; i++) {
    app.db.prepare('UPDATE studio_versions SET created_at = created_at - 700 WHERE doc_id = ?').run(c.id);
    const g = (await app.call('GET', `${base}/${w.id}/docs/${c.id}`, { tok: a.tok })).j;
    await app.call('PUT', `${base}/${w.id}/docs/${c.id}`, { tok: a.tok, body: { versao_base: g.versao, corpo: 'texto ' + i } });
  }
  assert.ok(n() <= 50, 'mantem no maximo 50 snapshots');
});

test('autorizacao: outro autor nao ve, nao edita, nao move, nao apaga (404, sem revelar existencia)', async () => {
  const app = makeApp(); const a = app.addUser(); const b = app.addUser();
  const w = await novaObra(app, a.tok, 'Segredo da A');
  const ms = pasta(w, 'manuscrito');
  const c = (await app.call('POST', `${base}/${w.id}/docs`, { tok: a.tok, body: { pai: ms.id, titulo: 'Cap secreto' } })).j;
  await app.call('PUT', `${base}/${w.id}/docs/${c.id}`, { tok: a.tok, body: { versao_base: 1, corpo: 'conteúdo privado' } });

  const tentativas = [
    ['GET', `${base}/${w.id}`], ['PATCH', `${base}/${w.id}`, { titulo: 'roubada' }], ['DELETE', `${base}/${w.id}`],
    ['GET', `${base}/${w.id}/docs/${c.id}`], ['PUT', `${base}/${w.id}/docs/${c.id}`, { versao_base: 2, corpo: 'invadido' }],
    ['DELETE', `${base}/${w.id}/docs/${c.id}`], ['POST', `${base}/${w.id}/docs/${c.id}/move`, { pai: null }],
    ['POST', `${base}/${w.id}/docs/${c.id}/duplicate`], ['POST', `${base}/${w.id}/docs`, { titulo: 'plantado' }],
    ['GET', `${base}/${w.id}/trash`], ['POST', `${base}/${w.id}/restore`],
  ];
  for (const [m, p, body] of tentativas) {
    const r = await app.call(m, p, { tok: b.tok, body });
    assert.equal(r.s, 404, `${m} ${p} deveria ser 404, veio ${r.s}`);
  }
  assert.equal((await app.call('GET', base, { tok: b.tok })).j.obras.length, 0, 'a lista do outro autor nao mostra obras alheias');
  assert.equal((await app.call('GET', `${base}/${w.id}/docs/${c.id}`, { tok: a.tok })).j.corpo, 'conteúdo privado', 'nada foi alterado');

  // documento de outra obra usado pelo caminho de uma obra propria: tambem 404
  const wb = await novaObra(app, b.tok, 'Obra da B');
  assert.equal((await app.call('GET', `${base}/${wb.id}/docs/${c.id}`, { tok: b.tok })).s, 404);
  assert.equal((await app.call('PUT', `${base}/${wb.id}/docs/${c.id}`, { tok: b.tok, body: { versao_base: 2, corpo: 'x' } })).s, 404);
  // pasta de destino de outra obra: recusada
  const docB = (await app.call('POST', `${base}/${wb.id}/docs`, { tok: b.tok, body: { titulo: 'meu' } })).j;
  assert.equal((await app.call('POST', `${base}/${wb.id}/docs/${docB.id}/move`, { tok: b.tok, body: { pai: ms.id } })).s, 400);
  assert.equal((await app.call('POST', `${base}/${wb.id}/docs`, { tok: b.tok, body: { pai: ms.id, titulo: 'x' } })).s, 400);
});

test('sem login: 401; leitor: 403; ids malformados: 404', async () => {
  const app = makeApp(); const a = app.addUser(); const l = app.addUser({ role: 'leitor', nome: 'Leitora' });
  assert.equal((await app.call('GET', base)).s, 401);
  assert.equal((await app.call('POST', base, { body: { titulo: 'x' } })).s, 401);
  assert.equal((await app.call('GET', base, { tok: l.tok })).s, 403);
  assert.equal((await app.call('POST', base, { tok: l.tok, body: { titulo: 'x' } })).s, 403);
  assert.equal((await app.call('GET', `${base}/nao-e-um-id`, { tok: a.tok })).s, 404);
  assert.equal((await app.call('GET', `${base}/abcdefabcdef/docs/../x`, { tok: a.tok })).s, 404);
});

test('POST sem o cabecalho CSRF e recusado', async () => {
  const app = makeApp(); const a = app.addUser();
  const r = await app.worker.fetch(new Request('https://t' + base, { method: 'POST', headers: { Cookie: 'sid=' + a.tok, 'Content-Type': 'application/json' }, body: '{"titulo":"x"}' }), app.env);
  assert.equal(r.status, 403);
});

test('lixeira: enviar pasta com filhos, restaurar so o que foi junto, apagar definitivo so da lixeira', async () => {
  const app = makeApp(); const a = app.addUser();
  const w = await novaObra(app, a.tok);
  const ms = pasta(w, 'manuscrito');
  const mk = async (pai, titulo) => (await app.call('POST', `${base}/${w.id}/docs`, { tok: a.tok, body: { pai, titulo, doc_tipo: 'capitulo' } })).j.id;
  const c1 = await mk(ms.id, 'C1'), c2 = await mk(ms.id, 'C2');
  await app.call('DELETE', `${base}/${w.id}/docs/${c1}`, { tok: a.tok }); // c1 vai antes, sozinho
  await new Promise((r) => setTimeout(r, 1100));                          // carimbo de tempo diferente
  const t = await app.call('DELETE', `${base}/${w.id}/docs/${ms.id}`, { tok: a.tok });
  assert.equal(t.j.enviados, 2, 'a pasta e o capitulo C2 (C1 ja estava fora)');
  const tree = (await app.call('GET', `${base}/${w.id}`, { tok: a.tok })).j.itens;
  assert.ok(!tree.some((i) => [ms.id, c1, c2].includes(i.id)), 'sumiu da arvore');
  assert.equal((await app.call('GET', `${base}/${w.id}/docs/${c2}`, { tok: a.tok })).s, 404, 'documento na lixeira nao abre');
  assert.equal((await app.call('GET', `${base}/${w.id}/trash`, { tok: a.tok })).j.itens.length, 3);

  assert.equal((await app.call('DELETE', `${base}/${w.id}/docs/${c2}?definitivo=1`, { tok: a.tok })).s, 200, 'definitivo funciona para item na lixeira');
  assert.equal((await app.call('POST', `${base}/${w.id}/docs/${ms.id}/restore`, { tok: a.tok })).s, 200);
  const dep = (await app.call('GET', `${base}/${w.id}`, { tok: a.tok })).j.itens.map((i) => i.id);
  assert.ok(dep.includes(ms.id), 'pasta voltou');
  assert.ok(!dep.includes(c1), 'C1 foi apagado antes e continua na lixeira');
  const alive = await app.call('DELETE', `${base}/${w.id}/docs/${ms.id}?definitivo=1`, { tok: a.tok });
  assert.equal(alive.s, 409, 'nao apaga definitivo algo que nao esta na lixeira');
  // filho restaurado cuja pasta continua na lixeira volta para a raiz
  await app.call('POST', `${base}/${w.id}/docs/${c1}/restore`, { tok: a.tok });
  assert.equal((await app.call('GET', `${base}/${w.id}/docs/${c1}`, { tok: a.tok })).j.pai, ms.id, 'pasta pai estava viva, mantem o pai');
});

test('mover e reordenar; nao permite mover pasta para dentro de si mesma', async () => {
  const app = makeApp(); const a = app.addUser();
  const w = await novaObra(app, a.tok);
  const ms = pasta(w, 'manuscrito'), pers = pasta(w, 'personagens');
  const mk = async (pai, titulo) => (await app.call('POST', `${base}/${w.id}/docs`, { tok: a.tok, body: { pai, titulo } })).j.id;
  const x = await mk(ms.id, 'X'), y = await mk(ms.id, 'Y'), z = await mk(ms.id, 'Z');
  await app.call('POST', `${base}/${w.id}/docs/${z}/move`, { tok: a.tok, body: { pai: ms.id, posicao: 0.5 } });
  const ordem = (await app.call('GET', `${base}/${w.id}`, { tok: a.tok })).j.itens.filter((i) => i.pai === ms.id).map((i) => i.titulo);
  assert.deepEqual(ordem, ['Z', 'X', 'Y']);
  await app.call('POST', `${base}/${w.id}/docs/${y}/move`, { tok: a.tok, body: { pai: pers.id } });
  assert.equal((await app.call('GET', `${base}/${w.id}/docs/${y}`, { tok: a.tok })).j.pai, pers.id);
  const sub = await mk(ms.id, 'não é pasta');
  const filha = (await app.call('POST', `${base}/${w.id}/docs`, { tok: a.tok, body: { pai: ms.id, tipo: 'pasta', titulo: 'Sub' } })).j.id;
  assert.equal((await app.call('POST', `${base}/${w.id}/docs/${ms.id}/move`, { tok: a.tok, body: { pai: filha } })).s, 400, 'ciclo');
  assert.equal((await app.call('POST', `${base}/${w.id}/docs/${ms.id}/move`, { tok: a.tok, body: { pai: ms.id } })).s, 400);
  assert.equal((await app.call('POST', `${base}/${w.id}/docs/${x}/move`, { tok: a.tok, body: { pai: sub } })).s, 400, 'documento nao pode ser pasta destino');
});

test('duplicar coloca a copia logo depois do original', async () => {
  const app = makeApp(); const a = app.addUser();
  const w = await novaObra(app, a.tok);
  const ms = pasta(w, 'manuscrito');
  const mk = async (titulo, corpo) => { const id = (await app.call('POST', `${base}/${w.id}/docs`, { tok: a.tok, body: { pai: ms.id, titulo } })).j.id; if (corpo) await app.call('PUT', `${base}/${w.id}/docs/${id}`, { tok: a.tok, body: { versao_base: 1, corpo } }); return id; };
  const x = await mk('X', 'texto de X'); await mk('Y');
  const d = await app.call('POST', `${base}/${w.id}/docs/${x}/duplicate`, { tok: a.tok });
  assert.equal(d.s, 201);
  const itens = (await app.call('GET', `${base}/${w.id}`, { tok: a.tok })).j.itens.filter((i) => i.pai === ms.id);
  assert.deepEqual(itens.map((i) => i.titulo), ['X', 'X (cópia)', 'Y']);
  assert.equal((await app.call('GET', `${base}/${w.id}/docs/${d.j.id}`, { tok: a.tok })).j.corpo, 'texto de X');
  assert.equal((await app.call('POST', `${base}/${w.id}/docs/${ms.id}/duplicate`, { tok: a.tok })).s, 400, 'pasta nao duplica ainda');
});

test('limites, validacoes e status controlado', async () => {
  const app = makeApp(); const a = app.addUser();
  const w = await novaObra(app, a.tok);
  const c = (await app.call('POST', `${base}/${w.id}/docs`, { tok: a.tok, body: { titulo: 'Gigante' } })).j;
  assert.equal((await app.call('PUT', `${base}/${w.id}/docs/${c.id}`, { tok: a.tok, body: { versao_base: 1, corpo: 'a'.repeat(1000001) } })).s, 413);
  assert.equal((await app.call('PUT', `${base}/${w.id}/docs/${c.id}`, { tok: a.tok, body: { versao_base: 1, corpo: 123 } })).s, 400);
  for (const s of ['publicado', 'agendado', 'atualizado', 'qualquer']) assert.equal((await app.call('PATCH', `${base}/${w.id}`, { tok: a.tok, body: { status: s } })).s, 400, `status ${s} nao muda por PATCH`);
  assert.equal((await app.call('PATCH', `${base}/${w.id}`, { tok: a.tok, body: { status: 'em_revisao', titulo: 'Novo título', meta: { sinopse: 'S', meta_palavras: '80000' } } })).s, 200);
  const g = (await app.call('GET', `${base}/${w.id}`, { tok: a.tok })).j.obra;
  assert.equal(g.status, 'em_revisao'); assert.equal(g.titulo, 'Novo título'); assert.equal(g.meta.meta_palavras, 80000);
  // limite de obras por autor
  for (let i = 0; i < 29; i++) assert.equal((await app.call('POST', base, { tok: a.tok, body: { titulo: 'Obra ' + i } })).s, 201);
  assert.equal((await app.call('POST', base, { tok: a.tok, body: { titulo: 'a mais' } })).s, 403);
});

test('progresso e contagem de palavras por obra', async () => {
  const app = makeApp(); const a = app.addUser();
  const w = await novaObra(app, a.tok);
  await app.call('PATCH', `${base}/${w.id}`, { tok: a.tok, body: { meta: { meta_palavras: 100 } } });
  const ms = pasta(w, 'manuscrito');
  const c = (await app.call('POST', `${base}/${w.id}/docs`, { tok: a.tok, body: { pai: ms.id, doc_tipo: 'capitulo', titulo: 'C' } })).j;
  await app.call('PUT', `${base}/${w.id}/docs/${c.id}`, { tok: a.tok, body: { versao_base: 1, corpo: 'um dois três quatro cinco-seis d’água' } });
  const nota = (await app.call('POST', `${base}/${w.id}/docs`, { tok: a.tok, body: { doc_tipo: 'nota', titulo: 'N' } })).j;
  await app.call('PUT', `${base}/${w.id}/docs/${nota.id}`, { tok: a.tok, body: { versao_base: 1, corpo: 'palavras que nao contam no manuscrito' } });
  const o = (await app.call('GET', base, { tok: a.tok })).j.obras[0];
  assert.equal(o.palavras, 6, 'so capitulos e cenas contam no progresso (hifen e apostrofo mantem a palavra)');
  assert.equal(o.progresso, 0.06);
});

test('rascunhos nunca vazam em respostas publicas', async () => {
  const app = makeApp(); const a = app.addUser();
  const w = await novaObra(app, a.tok, 'TITULO-SECRETO-DO-ESTUDIO');
  const c = (await app.call('POST', `${base}/${w.id}/docs`, { tok: a.tok, body: { titulo: 'CAPITULO-SECRETO' } })).j;
  await app.call('PUT', `${base}/${w.id}/docs/${c.id}`, { tok: a.tok, body: { versao_base: 1, corpo: 'TEXTO-SECRETO' } });
  for (const p of ['/api/authors', `/api/profile/${a.slug}`, '/api/config', '/autores.html']) {
    const r = await app.call('GET', p);
    const txt = JSON.stringify(r.j) + '';
    assert.ok(!/SECRETO/.test(txt), `${p} nao pode conter o rascunho`);
  }
});

test('excluir obra e restaurar; obra excluida nao abre', async () => {
  const app = makeApp(); const a = app.addUser();
  const w = await novaObra(app, a.tok);
  assert.equal((await app.call('DELETE', `${base}/${w.id}`, { tok: a.tok })).s, 200);
  assert.equal((await app.call('GET', `${base}/${w.id}`, { tok: a.tok })).s, 404);
  assert.equal((await app.call('GET', base, { tok: a.tok })).j.obras.length, 0);
  assert.equal((await app.call('POST', `${base}/${w.id}/restore`, { tok: a.tok })).s, 200);
  assert.equal((await app.call('GET', `${base}/${w.id}`, { tok: a.tok })).s, 200);
});
