// Feedback do beta: com ou sem conta, validado, sem guardar parametros da pagina de origem, limitado por IP,
// e so moderadores leem e marcam como visto.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp } from './helpers.mjs';

const enviar = (app, body, opts = {}) => app.call('POST', '/api/feedback', { body, ...opts });
const BOM = { area: 'estudio', categoria: 'bug', descricao: 'O botao de exportar nao respondeu no celular.', pagina: '/estudio.html' };

test('feedback: visitante e leitor enviam; moderador le com area, tipo, pagina, quem e quando; marca como visto', async () => {
  const app = makeApp();
  const mod = app.addUser({ mod: true });
  const l = app.addUser({ role: 'leitor', nome: 'Lia' });
  assert.equal((await enviar(app, BOM)).s, 200, 'sem conta tambem pode');
  assert.equal((await enviar(app, { ...BOM, categoria: 'confusao', pagina: '/redefinir.html?token=abc123#x' }, { tok: l.tok })).s, 200);

  assert.equal((await app.call('GET', '/api/admin/feedback', { tok: l.tok })).s, 403, 'so moderador le');
  const lista = (await app.call('GET', '/api/admin/feedback', { tok: mod.tok })).j;
  assert.equal(lista.length, 2);
  const daLia = lista.find((f) => f.quem === 'Lia');
  assert.equal(daLia.pagina, '/redefinir.html', 'token e parametros da pagina de origem nao sao guardados');
  assert.equal(daLia.categoria_rotulo, 'Confusão (não entendi)'); assert.equal(daLia.area_rotulo, 'Estúdio (escrever)');
  assert.ok(daLia.created_at > 0); assert.equal(daLia.status, 'novo');
  assert.equal(lista.find((f) => f.quem === null).pagina, '/estudio.html');

  assert.equal((await app.call('POST', `/api/admin/feedback/${daLia.id}`, { tok: l.tok, body: { status: 'visto' } })).s, 403);
  assert.equal((await app.call('POST', `/api/admin/feedback/${daLia.id}`, { tok: mod.tok, body: { status: 'visto' } })).s, 200);
  assert.equal((await app.call('GET', '/api/admin/feedback', { tok: mod.tok })).j.length, 1, 'visto sai da lista de novos');
  assert.equal((await app.call('GET', '/api/admin/feedback?todos=1', { tok: mod.tok })).j.length, 2);
});

test('feedback: validacao e limite por IP', async () => {
  const app = makeApp();
  assert.equal((await enviar(app, { ...BOM, area: 'x' })).s, 400);
  assert.equal((await enviar(app, { ...BOM, categoria: 'elogio' })).s, 400);
  assert.equal((await enviar(app, { ...BOM, descricao: 'curto' })).s, 400);
  assert.equal((await enviar(app, { ...BOM, pagina: 'javascript:alert(1)' })).s, 200, 'pagina estranha e descartada, o resto vale');
  for (let i = 0; i < 7; i++) await enviar(app, BOM, { ip: '9.9.9.9' });
  assert.equal((await enviar(app, BOM, { ip: '9.9.9.9' })).s, 200, 'oitavo ainda passa');
  assert.equal((await enviar(app, BOM, { ip: '9.9.9.9' })).s, 429, 'nono no mesmo IP em 15 min');
  assert.equal((await enviar(app, BOM, { ip: '8.8.8.8' })).s, 200, 'outro IP segue');
});
