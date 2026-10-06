import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp } from './helpers.mjs';

const cadastrar = (app, convite, email = 'nova@teste.local') => app.call('POST', '/api/register', { body: { convite, email, senha: 'senha-segura-123', nome: 'Nova Autora', aceite: true } });

test('moderador gera convite; autor se cadastra com ele; o convite nao serve de novo', async () => {
  const app = makeApp();
  const mod = app.addUser({ mod: true, nome: 'Moderadora' });
  const r = await app.call('POST', '/api/admin/convites', { tok: mod.tok, body: { para: 'Maria' } });
  assert.equal(r.s, 200, JSON.stringify(r.j));
  assert.match(r.j.codigo, /^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/);
  assert.equal(r.j.link, `https://t/conta.html#convite=${r.j.codigo}`);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM invites WHERE code_hash = ?').get(r.j.codigo)?.n ?? 0, 0, 'o codigo em claro nao vai para o banco');

  let lista = (await app.call('GET', '/api/admin/convites', { tok: mod.tok })).j;
  assert.equal(lista[0].para, 'Maria'); assert.equal(lista[0].situacao, 'aberto');

  const c = await cadastrar(app, r.j.codigo.toLowerCase());
  assert.equal(c.s, 200, JSON.stringify(c.j));
  assert.equal(c.j.slug, 'nova-autora');
  lista = (await app.call('GET', '/api/admin/convites', { tok: mod.tok })).j;
  assert.equal(lista[0].situacao, 'usado'); assert.equal(lista[0].usado_por, 'nova-autora');

  assert.equal((await cadastrar(app, r.j.codigo, 'outra@teste.local')).s, 403);
});

test('convite expirado nao abre cadastro; so moderador gera e lista', async () => {
  const app = makeApp();
  const mod = app.addUser({ mod: true });
  const autor = app.addUser();
  const r = await app.call('POST', '/api/admin/convites', { tok: mod.tok, body: {} });
  app.db.prepare('UPDATE invites SET expires_at = 1').run();
  const c = await cadastrar(app, r.j.codigo);
  assert.equal(c.s, 403); assert.match(c.j.erro, /expirou/);

  assert.equal((await app.call('POST', '/api/admin/convites', { tok: autor.tok, body: {} })).s, 403);
  assert.equal((await app.call('GET', '/api/admin/convites', { tok: autor.tok })).s, 403);
  assert.equal((await app.call('POST', '/api/admin/convites', { body: {} })).s, 401);
});

test('perfil: faixa etaria e lancamento validados; data de entrada no site e do servidor e nao muda', async () => {
  const app = makeApp();
  const a = app.addUser({ nome: 'Ana' });
  const base = { nome: 'Ana', links: [], secoes: [] };
  const salvar = (obras) => app.call('PUT', '/api/profile', { tok: a.tok, body: { data: { ...base, obras } } });
  let r = await salvar([{ titulo: 'Livro', faixa: '14', publicado_em: '2025-03', no_site_em: 1 }]);
  assert.equal(r.s, 200, JSON.stringify(r.j));
  const o = r.j.data.obras[0];
  assert.equal(o.faixa, '14'); assert.equal(o.publicado_em, '2025-03');
  const t = JSON.parse(app.db.prepare('SELECT data FROM profiles WHERE slug = ?').get(a.slug).data).obras[0].no_site_em;
  assert.ok(t > 1000, 'o servidor ignora a data enviada pelo autor');
  r = await salvar([{ id: o.id, titulo: 'Livro', faixa: '99', publicado_em: '1800' }]);
  const o2 = JSON.parse(app.db.prepare('SELECT data FROM profiles WHERE slug = ?').get(a.slug).data).obras[0];
  assert.equal(o2.faixa, ''); assert.equal(o2.publicado_em, ''); assert.equal(o2.no_site_em, t, 'mantem a data de entrada');
});

test('cadastro exige aceite dos Termos, Privacidade e Diretrizes e grava quando foi aceito', async () => {
  const app = makeApp();
  const m = app.addUser({ mod: true });
  const conv = (await app.call('POST', '/api/admin/convites', { tok: m.tok, body: {} })).j.codigo;
  const sem = await app.call('POST', '/api/register', { body: { convite: conv, email: 'sem@teste.local', senha: 'senha-segura-123', nome: 'Sem Aceite' } });
  assert.equal(sem.s, 400); assert.match(sem.j.erro, /Termos de Uso/);
  assert.equal((await cadastrar(app, conv, 'com@teste.local')).s, 200);
  assert.ok(app.db.prepare('SELECT accepted_at FROM users WHERE email = ?').get('com@teste.local').accepted_at > 0);

  const leitor = (aceite) => app.call('POST', '/api/register-leitor', { body: { nome: 'Lia', email: `lia${aceite}@teste.local`, senha: 'senha-segura-123', aceite } });
  assert.equal((await leitor('on')).s, 400, 'so true conta como aceite');
  assert.equal((await leitor(true)).s, 200);
  assert.ok(app.db.prepare('SELECT accepted_at FROM users WHERE email = ?').get('liatrue@teste.local').accepted_at > 0);
});
