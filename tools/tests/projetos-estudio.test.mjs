import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp } from './helpers.mjs';

async function cenario() {
  const app = makeApp({ ESTUDIO_PUBLICACAO: 'on' });
  const a = app.addUser({ nome: 'Ana' });
  await app.call('PUT', '/api/profile', { tok: a.tok, body: { data: { nome: 'Ana Autora', links: [], secoes: [], obras: [] } } });
  const w = (await app.call('POST', '/api/studio/works', { tok: a.tok, body: { titulo: 'O Rio' } })).j.id;
  await app.call('POST', `/api/studio/works/${w}/docs`, { tok: a.tok, body: { doc_tipo: 'capitulo', titulo: 'C1', corpo: 'uma duas tres quatro cinco' } });
  await app.call('POST', `/api/studio/works/${w}/docs`, { tok: a.tok, body: { doc_tipo: 'nota', titulo: 'N', corpo: 'nota nao conta palavra nenhuma aqui' } });
  const editar = (meta, extra = {}) => app.call('PATCH', `/api/studio/works/${w}`, { tok: a.tok, body: { meta, ...extra } });
  const projetos = async () => (await app.call('GET', '/api/site')).j.projetos.filter((p) => p.estudio);
  return { app, a, w, editar, projetos };
}

test('Projetos: obra do Estudio so aparece quando o autor marca; progresso pela meta de palavras', async () => {
  const { app, editar, projetos } = await cenario();
  assert.deepEqual(await projetos(), [], 'sem marcar, nada aparece');
  assert.equal((await editar({ sinopse: 'Um rio.', generos: ['Fantasia'], tipo: 'Romance', meta_palavras: 10, projeto: { mostrar: true, etapa: 'Revisão', previsao: 'mar/2027', trecho: 'Era uma vez.' } })).s, 200);
  const [p] = await projetos();
  assert.deepEqual({ ...p }, { titulo: 'O Rio', autor: 'Ana Autora', autor_slug: p.autor_slug, genero: 'Fantasia', etapa: 'Revisão', pct: 50, previsao: 'mar/2027', sinopse: 'Um rio.', trecho: 'Era uma vez.', estudio: true });
  // o painel da moderacao nao recebe (nem regrava) os projetos do Estudio
  const mod = app.addUser({ role: 'moderador' });
  const adm = await app.call('GET', '/api/admin/site', { tok: mod.tok });
  if (adm.s === 200) assert.ok(!adm.j.dados.projetos.some((x) => x.estudio));
  // sem meta: sem porcentagem; etapa invalida vira "Em escrita"
  await editar({ meta_palavras: 0, projeto: { mostrar: true, etapa: 'Hackeado' } });
  const [q] = await projetos();
  assert.equal(q.pct, null); assert.equal(q.etapa, 'Em escrita');
  // desmarcar tira
  await editar({ projeto: { mostrar: false } });
  assert.deepEqual(await projetos(), []);
});

test('Projetos: some quando a obra e arquivada, publicada ou apagada, ou se o perfil nao esta publicado', async () => {
  const { app, a, w, editar, projetos } = await cenario();
  await editar({ projeto: { mostrar: true } });
  assert.equal((await projetos()).length, 1);
  await editar({}, { status: 'arquivado' });
  assert.equal((await projetos()).length, 0, 'arquivada');
  await editar({}, { status: 'em_revisao' });
  assert.equal((await projetos()).length, 1, 'em revisao aparece');
  app.db.prepare('UPDATE profiles SET published = 0 WHERE user_id = ?').run(a.id);
  assert.equal((await projetos()).length, 0, 'perfil nao publicado');
  app.db.prepare('UPDATE profiles SET published = 1 WHERE user_id = ?').run(a.id);
  app.db.prepare("UPDATE studio_works SET status = 'publicado' WHERE id = ?").run(w);
  assert.equal((await projetos()).length, 0, 'publicada vai para a Biblioteca');
  app.db.prepare("UPDATE studio_works SET status = 'rascunho', deleted_at = 1 WHERE id = ?").run(w);
  assert.equal((await projetos()).length, 0, 'na lixeira');
});
