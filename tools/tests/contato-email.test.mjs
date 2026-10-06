// Caixa do contato@: o e-mail que chega pelo Email Routing vai em copia para o Proton e fica guardado para os
// moderadores lerem no painel. Nada se perde se uma das duas partes falhar.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp } from './helpers.mjs';

const MIME = [
  'From: =?UTF-8?Q?Jo=C3=A3o_Leitor?= <joao@exemplo.com>',
  'To: contato@entrelinhasbr.com.br',
  'Reply-To: joao.resposta@exemplo.com',
  'Subject: =?UTF-8?Q?D=C3=BAvida_sobre_direitos_autorais?=',
  'Message-ID: <abc123@exemplo.com>',
  'MIME-Version: 1.0',
  'Content-Type: text/plain; charset=utf-8',
  'Content-Transfer-Encoding: quoted-printable',
  '',
  'Ol=C3=A1! Meu conto foi publicado no site sem autoriza=C3=A7=C3=A3o.',
  '',
].join('\r\n');

// imita o ForwardableEmailMessage do Cloudflare
function emailFalso(raw = MIME, { falhaCopia = false } = {}) {
  const copias = [];
  const bytes = new TextEncoder().encode(raw);
  return {
    copias,
    from: 'joao@exemplo.com', to: 'contato@entrelinhasbr.com.br', rawSize: bytes.byteLength,
    raw: new Response(bytes).body,
    forward: async (para) => { if (falhaCopia) throw new Error('destino nao verificado'); copias.push(para); },
  };
}
const ENV = { CONTATO_COPIA: 'entrelinhas.comm@protonmail.com' };

test('e-mail recebido: copia para o Proton e mensagem legivel no painel (acentos, assunto, responder para)', async () => {
  const app = makeApp(ENV);
  const mod = app.addUser({ mod: true, nome: 'Mod' });
  const autor = app.addUser({ nome: 'Autor comum' });
  const msg = emailFalso();
  await app.worker.email(msg, app.env);
  assert.deepEqual(msg.copias, ['entrelinhas.comm@protonmail.com']);

  assert.equal((await app.call('GET', '/api/admin/mensagens', { tok: autor.tok })).s, 403, 'so moderadores leem');
  const [m] = (await app.call('GET', '/api/admin/mensagens', { tok: mod.tok })).j;
  assert.equal(m.remetente, 'joao@exemplo.com'); assert.equal(m.nome, 'João Leitor');
  assert.equal(m.assunto, 'Dúvida sobre direitos autorais');
  assert.equal(m.responder_para, 'joao.resposta@exemplo.com');
  assert.match(m.texto, /publicado no site sem autorização/);
  assert.equal(m.status, 'nova');

  assert.equal((await app.call('POST', `/api/admin/mensagens/${m.id}`, { tok: autor.tok, body: { status: 'lida' } })).s, 403);
  assert.equal((await app.call('POST', `/api/admin/mensagens/${m.id}`, { tok: mod.tok, body: { status: 'lida' } })).s, 200);
  const lida = (await app.call('GET', '/api/admin/mensagens', { tok: mod.tok })).j[0];
  assert.equal(lida.status, 'lida'); assert.equal(lida.lida_por, 'Mod');
  await app.call('POST', `/api/admin/mensagens/${m.id}`, { tok: mod.tok, body: { status: 'arquivada' } });
  assert.equal((await app.call('GET', '/api/admin/mensagens', { tok: mod.tok })).j.length, 0, 'arquivada sai da lista');
  assert.equal((await app.call('GET', '/api/admin/mensagens?todas=1', { tok: mod.tok })).j.length, 1);
});

test('se a copia falhar a mensagem fica no painel; se o banco falhar a copia ja foi; se tudo falhar, o erro aparece', async () => {
  const app = makeApp(ENV);
  await app.worker.email(emailFalso(MIME, { falhaCopia: true }), app.env);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM contato_mensagens').get().n, 1);

  const semBanco = makeApp(ENV);
  semBanco.db.exec('DROP TABLE contato_mensagens');
  const msg = emailFalso();
  await semBanco.worker.email(msg, semBanco.env);
  assert.equal(msg.copias.length, 1, 'a copia saiu mesmo sem banco');
  await assert.rejects(semBanco.worker.email(emailFalso(MIME, { falhaCopia: true }), semBanco.env), 'nada entregue: o erro sobe');
});

test('e-mail so em HTML vira texto; mensagens com mais de 1 ano saem na tarefa diaria', async () => {
  const app = makeApp(ENV);
  const html = MIME.replace('Content-Type: text/plain; charset=utf-8', 'Content-Type: text/html; charset=utf-8')
    .replace('Ol=C3=A1! Meu conto', '<p>Ol=C3=A1!<br>Meu <b>conto</b><script>x()</script>');
  await app.worker.email(emailFalso(html), app.env);
  const t = app.db.prepare('SELECT texto FROM contato_mensagens').get().texto;
  assert.match(t, /Olá!\s*\nMeu conto/); assert.ok(!t.includes('<') && !t.includes('x()'), 'sem tags nem script');

  app.db.prepare('UPDATE contato_mensagens SET recebida_em = ?').run(Math.floor(Date.now() / 1000) - 400 * 86400);
  const tarefas = [];
  await app.worker.scheduled({}, app.env, { waitUntil: (p) => tarefas.push(p) });
  await Promise.all(tarefas);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM contato_mensagens').get().n, 0);
});
