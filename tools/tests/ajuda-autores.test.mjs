import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp } from './helpers.mjs';

const pedido = { tipo: 'beta', titulo: 'O Rio', genero: 'Fantasia', descricao: 'Uma menina que lembra de tudo segue o rio.', retorno: 'Ritmo do começo', acesso: 'https://docs.exemplo.com/rio', vagas: 1 };
const badges = (app, id) => JSON.parse(app.db.prepare('SELECT badges FROM profiles WHERE user_id = ?').get(id).badges);

test('leitura beta: pedir, oferecer, aceitar, concluir e ganhar o selo', async () => {
  const app = makeApp();
  const a = app.addUser({ nome: 'Ana' }), b = app.addUser({ nome: 'Beto' }), c = app.addUser({ nome: 'Caio' });

  let r = await app.call('POST', '/api/ajuda', { tok: a.tok, body: pedido });
  assert.equal(r.s, 200, JSON.stringify(r.j));
  const id = r.j.meus[0].id;

  // quem ainda nao foi aceito nao ve o acesso ao original
  r = await app.call('GET', '/api/ajuda', { tok: b.tok });
  assert.equal(r.j.abertos.length, 1); assert.equal(r.j.abertos[0].autor_nome, 'Ana');
  assert.ok(!('acesso' in r.j.abertos[0]));
  assert.equal((await app.call('POST', `/api/ajuda/${id}/oferta`, { tok: a.tok, body: {} })).s, 403, 'nao se oferece para o proprio pedido');
  r = await app.call('POST', `/api/ajuda/${id}/oferta`, { tok: b.tok, body: { msg: 'Leio fantasia toda semana.' } });
  assert.equal(r.s, 200); assert.equal(r.j.ajudas[0].acesso, '');
  assert.equal((await app.call('POST', `/api/ajuda/${id}/oferta`, { tok: b.tok, body: {} })).s, 409, 'uma oferta por pessoa');
  await app.call('POST', `/api/ajuda/${id}/oferta`, { tok: c.tok, body: {} });

  assert.equal((await app.call('POST', `/api/ajuda/${id}/oferta/${b.id}`, { tok: c.tok, body: { acao: 'aceitar' } })).s, 404, 'so o dono decide');
  assert.equal((await app.call('POST', `/api/ajuda/${id}/oferta/${b.id}`, { tok: a.tok, body: { acao: 'concluir' } })).s, 409, 'concluir exige aceite');
  r = await app.call('POST', `/api/ajuda/${id}/oferta/${b.id}`, { tok: a.tok, body: { acao: 'aceitar' } });
  assert.equal(r.s, 200); assert.equal(r.j.meus[0].ofertas.find((o) => o.user_id === b.id).nome, 'Beto');
  assert.equal((await app.call('POST', `/api/ajuda/${id}/oferta/${c.id}`, { tok: a.tok, body: { acao: 'aceitar' } })).s, 409, 'vagas preenchidas');

  r = await app.call('GET', '/api/ajuda', { tok: b.tok });
  assert.equal(r.j.ajudas[0].acesso, 'https://docs.exemplo.com/rio', 'aceito ve o acesso');

  await app.call('POST', `/api/ajuda/${id}/oferta/${b.id}`, { tok: a.tok, body: { acao: 'concluir' } });
  assert.deepEqual(badges(app, b.id), ['Leitor beta']);
  // um selo por servico, sem acumular
  const id2 = (await app.call('POST', '/api/ajuda', { tok: a.tok, body: { ...pedido, titulo: 'Outro' } })).j.meus.find((x) => x.titulo === 'Outro').id;
  await app.call('POST', `/api/ajuda/${id2}/oferta`, { tok: b.tok, body: {} });
  await app.call('POST', `/api/ajuda/${id2}/oferta/${b.id}`, { tok: a.tok, body: { acao: 'aceitar' } });
  await app.call('POST', `/api/ajuda/${id2}/oferta/${b.id}`, { tok: a.tok, body: { acao: 'concluir' } });
  assert.deepEqual(badges(app, b.id), ['Leitor beta']);
  assert.equal((await app.call('DELETE', `/api/ajuda/${id2}/oferta`, { tok: b.tok })).s, 404, 'nao desiste do que ja concluiu');

  // fechar tira dos abertos
  await app.call('POST', `/api/ajuda/${id}/fechar`, { tok: a.tok });
  r = await app.call('GET', '/api/ajuda', { tok: c.tok });
  assert.deepEqual(r.j.abertos.map((x) => x.titulo), ['Outro']);
});

test('ajuda entre autores: validacao, servicos fechados, leitores e limites', async () => {
  const app = makeApp();
  const a = app.addUser();
  const l = app.addUser({ role: 'leitor' });
  assert.equal((await app.call('GET', '/api/ajuda')).s, 401);
  assert.equal((await app.call('GET', '/api/ajuda', { tok: l.tok })).s, 403);
  assert.equal((await app.call('POST', '/api/ajuda', { tok: l.tok, body: pedido })).s, 403);
  assert.equal((await app.call('POST', '/api/ajuda', { tok: a.tok, body: { ...pedido, tipo: 'capa' } })).s, 400, 'servico em breve');
  assert.equal((await app.call('POST', '/api/ajuda', { tok: a.tok, body: { ...pedido, acesso: '' } })).s, 400);
  assert.equal((await app.call('POST', '/api/ajuda', { tok: a.tok, body: { ...pedido, descricao: 'curta' } })).s, 400);
  const r = await app.call('POST', '/api/ajuda', { tok: a.tok, body: { ...pedido, vagas: 99 } });
  assert.equal(r.j.meus[0].vagas, 5, 'no maximo 5 vagas');
  for (let i = 0; i < 2; i++) assert.equal((await app.call('POST', '/api/ajuda', { tok: a.tok, body: pedido })).s, 200);
  assert.equal((await app.call('POST', '/api/ajuda', { tok: a.tok, body: pedido })).s, 409, 'no maximo 3 abertos');
});
