import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp } from './helpers.mjs';

test('conteudo da pagina inicial: vem do banco, ja com o que estava no data.json', async () => {
  const app = makeApp();
  const r = await app.call('GET', '/api/site');
  assert.equal(r.s, 200);
  assert.ok(r.j.servicos.length >= 1 && r.j.selos.length >= 1);
  assert.equal(r.j.noticias, undefined, 'noticias viraram posts da Comunidade');
  assert.equal(typeof r.j.contato.url, 'string');
});

test('conteudo da pagina inicial: so moderador edita, e o servidor valida cada campo', async () => {
  const app = makeApp();
  const mod = app.addUser({ mod: true });
  const autor = app.addUser();
  const leitor = app.addUser({ role: 'leitor' });
  const nova = [{ nome: 'Novo selo', texto: 'Ajudou muito.', extra: 'ignorado' }];

  assert.equal((await app.call('GET', '/api/admin/site', { tok: autor.tok })).s, 403);
  assert.equal((await app.call('PUT', '/api/admin/site/selos', { tok: autor.tok, body: { dados: nova } })).s, 403);
  assert.equal((await app.call('PUT', '/api/admin/site/selos', { tok: leitor.tok, body: { dados: nova } })).s, 403);
  assert.equal((await app.call('PUT', '/api/admin/site/selos', { body: { dados: nova } })).s, 401);

  const painel = await app.call('GET', '/api/admin/site', { tok: mod.tok });
  assert.equal(painel.s, 200);
  assert.ok(painel.j.secoes.selos.campos.length > 0 && !painel.j.secoes.noticias);

  const ok = await app.call('PUT', '/api/admin/site/selos', { tok: mod.tok, body: { dados: nova } });
  assert.equal(ok.s, 200, JSON.stringify(ok.j));
  assert.deepEqual((await app.call('GET', '/api/site')).j.selos, [{ nome: 'Novo selo', texto: 'Ajudou muito.' }]);

  const ruins = [
    ['selos', [{ ...nova[0], nome: '' }], /Preencha/],
    ['servicos', [{ titulo: 'X', link: 'javascript:alert(1)' }], /Link/],
    ['contato', { url: 'javascript:alert(1)' }, /Contato/],
    ['projetos', Array.from({ length: 31 }, () => ({ titulo: 'P' })), /No máximo/],
  ];
  for (const [secao, dados, erro] of ruins) {
    const r = await app.call('PUT', `/api/admin/site/${secao}`, { tok: mod.tok, body: { dados } });
    assert.equal(r.s, 400, secao); assert.match(r.j.erro, erro);
  }
  assert.equal((await app.call('PUT', '/api/admin/site/livros', { tok: mod.tok, body: { dados: [] } })).s, 404);
  assert.equal((await app.call('PUT', '/api/admin/site/noticias', { tok: mod.tok, body: { dados: [] } })).s, 404, 'noticias saiu do painel');

  const p = await app.call('PUT', '/api/admin/site/projetos', { tok: mod.tok, body: { dados: [{ titulo: 'P', pct: 250, etapa: 'inventada', c1: 'red' }] } });
  assert.equal(p.s, 200);
  assert.equal(p.j.dados[0].pct, 100); assert.equal(p.j.dados[0].etapa, 'Planejamento'); assert.equal(p.j.dados[0].c1, '');
  const c = await app.call('PUT', '/api/admin/site/contato', { tok: mod.tok, body: { dados: { url: 'mailto:coletivo@entrelinhasbr.com.br' } } });
  assert.equal(c.s, 200);
});
