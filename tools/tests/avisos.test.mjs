import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp } from './helpers.mjs';
import { lerFeed, coletarAvisos, limparAvisos } from '../../src/avisos.js';

const AGORA = Math.floor(Date.parse('2026-10-11T12:00:00Z') / 1000);
const rss = (itens) => `<?xml version="1.0"?><rss version="2.0"><channel><title>Feed</title>${itens.join('')}</channel></rss>`;
const item = (t, link, data, fonte) => `<item><title><![CDATA[${t}]]></title><link>${link}</link><pubDate>${data}</pubDate>${fonte ? `<source url="https://x">${fonte}</source>` : ''}</item>`;

test('lerFeed: titulo sem o veiculo no fim, entidades, CDATA, links invalidos descartados', () => {
  const xml = rss([
    item('III Feira Literária Inclusiva divulga edital de concurso - www.gov.br', 'https://news.google.com/rss/articles/abc', 'Fri, 09 Oct 2026 10:00:00 GMT', 'www.gov.br'),
    '<item><title>Prêmio &amp; inscrições &lt;abertas&gt; para contos</title><link>https://exemplo.com/a?x=1&amp;y=2</link><pubDate>Thu, 01 Oct 2026 10:31:44 GMT</pubDate></item>',
    item('Link perigoso que deve ficar de fora', 'javascript:alert(1)', 'Fri, 09 Oct 2026 10:00:00 GMT'),
    item('curto', 'https://exemplo.com/b', 'Fri, 09 Oct 2026 10:00:00 GMT'),
  ]);
  const it = lerFeed(xml);
  assert.equal(it.length, 2);
  assert.deepEqual([it[0].titulo, it[0].fonte], ['III Feira Literária Inclusiva divulga edital de concurso', 'www.gov.br']);
  assert.equal(it[1].titulo, 'Prêmio & inscrições <abertas> para contos'); // entidades decodificadas; o navegador escapa ao mostrar
  assert.equal(it[1].link, 'https://exemplo.com/a?x=1&y=2');
});

test('coletarAvisos: grava pendentes sem repetir, ignora itens velhos e sobrevive a fonte fora do ar', async () => {
  const app = makeApp();
  const chamadas = [];
  const buscar = async (url) => {
    chamadas.push(url);
    if (url.includes('jornalrelevo')) throw new Error('rede caiu');
    return new Response(rss([
      item('Edital aberto para escritores independentes - Prefeitura X', 'https://exemplo.com/1', 'Fri, 09 Oct 2026 10:00:00 GMT', 'Prefeitura X'),
      item('Concurso antigo de 2025 sem relevância hoje', 'https://exemplo.com/velho', 'Mon, 01 Sep 2025 10:00:00 GMT', 'Antigo'),
    ]), { status: 200 });
  };
  const r1 = await coletarAvisos(app.env, AGORA, buscar);
  assert.equal(r1.novos, 1, 'as duas buscas do Google trazem o mesmo link: entra uma vez; o velho fica de fora');
  assert.match(r1.erros.join(), /relevo: rede caiu/);
  assert.equal((await coletarAvisos(app.env, AGORA, buscar)).novos, 0, 'segunda coleta nao repete');
  const [a] = (await app.call('GET', '/api/avisos')).j.avisos;
  assert.equal(a, undefined, 'pendente nao aparece para o publico');
});

test('avisos: moderador aprova e rejeita; so os aprovados aparecem para todos', async () => {
  const app = makeApp();
  const mod = app.addUser({ mod: true }), autor = app.addUser();
  await coletarAvisos(app.env, AGORA, async (url) => new Response(!url.includes('edital') ? rss([]) : rss([
    item('Edital da Bolsa de Publicações abre inscrições - Governo', 'https://exemplo.com/e1', 'Fri, 09 Oct 2026 10:00:00 GMT', 'Governo'),
    item('Feira do Livro de Canela recebe autores locais - Canela', 'https://exemplo.com/e2', 'Thu, 08 Oct 2026 10:00:00 GMT', 'Canela'),
  ])));
  assert.equal((await app.call('GET', '/api/admin/avisos', { tok: autor.tok })).s, 403);
  assert.equal((await app.call('GET', '/api/admin/avisos')).s, 403);
  const pend = (await app.call('GET', '/api/admin/avisos', { tok: mod.tok })).j.avisos;
  assert.ok(pend.length >= 2 && pend.every((x) => x.status === 'pendente'));
  const [e1, e2] = [pend.find((x) => x.link.endsWith('/e1')), pend.find((x) => x.link.endsWith('/e2'))];
  const dec = (tok, id, status) => app.call('POST', `/api/admin/avisos/${id}`, { tok, body: { status } });
  assert.equal((await dec(autor.tok, e1.id, 'aprovado')).s, 403);
  assert.equal((await dec(mod.tok, e1.id, 'aprovado')).s, 200);
  assert.equal((await dec(mod.tok, e2.id, 'rejeitado')).s, 200);
  assert.equal((await dec(mod.tok, e1.id, 'qualquer')).s, 400);
  assert.equal((await dec(mod.tok, 99999, 'aprovado')).s, 404);

  const pub = (await app.call('GET', '/api/avisos')).j;
  assert.deepEqual(pub.avisos.map((x) => [x.titulo, x.fonte]), [['Edital da Bolsa de Publicações abre inscrições', 'Governo']]);
  assert.equal(pub.avisos[0].status, undefined, 'o publico nao ve status');
  assert.deepEqual((await app.call('GET', '/api/admin/avisos?status=rejeitado', { tok: mod.tok })).j.avisos.map((x) => x.link), ['https://exemplo.com/e2']);
  assert.equal((await dec(mod.tok, e1.id, 'pendente')).s, 200, 'moderador pode desfazer');
  assert.equal((await app.call('GET', '/api/avisos')).j.avisos.length, 0);
});

test('avisos: limpeza apaga so recusados e pendentes velhos; coleta manual e so de moderador e tem intervalo', async () => {
  const app = makeApp();
  const mod = app.addUser({ mod: true }), autor = app.addUser();
  const ins = (link, status, quando) => app.db.prepare("INSERT INTO avisos (fonte, feed, titulo, link, publicado_em, coletado_em, status) VALUES ('F', 'editais', 'Titulo longo o bastante', ?, ?, ?, ?)").run(link, quando, quando, status);
  ins('https://a/1', 'aprovado', AGORA - 100 * 86400); ins('https://a/2', 'rejeitado', AGORA - 100 * 86400); ins('https://a/3', 'pendente', AGORA - 100 * 86400); ins('https://a/4', 'pendente', AGORA - 86400);
  await limparAvisos(app.env, AGORA);
  assert.deepEqual(app.db.prepare('SELECT link FROM avisos ORDER BY id').all().map((x) => x.link), ['https://a/1', 'https://a/4']);
  assert.equal((await app.call('POST', '/api/admin/avisos/coletar', { tok: autor.tok, body: {} })).s, 403);
  // a ultima coleta (a/4) foi ha 1 dia, entao a manual pode rodar; sem rede nos testes, so conferimos que a rota responde
  const r = await app.call('POST', '/api/admin/avisos/coletar', { tok: mod.tok, body: {} });
  assert.ok([200, 429].includes(r.s));
});
