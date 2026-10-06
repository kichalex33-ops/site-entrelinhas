// A politica de seguranca (CSP, src/index.js) nao pode bloquear nada que o site usa de verdade:
// abre cada pagina, como visitante e como autor, e falha se o navegador recusar algum recurso.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { iniciar } from './helpers.mjs';

let E2E;
before(async () => { E2E = await iniciar({ ESTUDIO_PUBLICACAO: 'on' }); });
after(async () => { await E2E.parar(); });

const VIOLACAO = /Content Security Policy|Refused to (load|execute|apply|connect|frame)/i;

async function varrer(pagina, caminhos) {
  const bloqueios = [];
  pagina.on('console', (m) => { if (VIOLACAO.test(m.text())) bloqueios.push(`${pagina.url()} -> ${m.text()}`); });
  for (const c of caminhos) {
    await pagina.goto(`${E2E.url}${c}`, { waitUntil: 'load' });
    await pagina.waitForTimeout(400);
  }
  return bloqueios;
}

test('CSP: paginas publicas e institucionais sem recurso bloqueado', async () => {
  const a = await E2E.novoAutor({ nome: 'Ana CSP' });
  const ctx = await E2E.navegador.newContext();
  const p = await ctx.newPage();
  const bloqueios = await varrer(p, ['/', '/autores.html', `/autor.html?a=${a.slug}`, '/leitores.html', '/sobre.html', '/termos.html',
    '/privacidade.html', '/diretrizes.html', '/conta.html', '/conta.html#criar', '/recuperar.html', '/redefinir.html?token=x', '/confirmar-email.html?token=x']);
  assert.deepEqual(bloqueios, []);
  await ctx.close();
});

test('CSP: Estudio, editor de capa e visualizador 3D (bibliotecas do cdnjs e unpkg, iframe do proprio site)', async () => {
  const a = await E2E.novoAutor({ nome: 'Bia CSP' });
  const bloqueios = await varrer(a.pagina, ['/estudio.html', '/conta.html', '/editor-capa.html', '/visualizador-capa.html', '/ajuda.html', '/lixeira.html']);
  assert.deepEqual(bloqueios, []);
  // o editor de capa depende do html2canvas e do jsPDF vindos do cdnjs
  await a.pagina.goto(`${E2E.url}/editor-capa.html`, { waitUntil: 'load' });
  assert.equal(await a.pagina.evaluate(() => typeof window.html2canvas), 'function', 'html2canvas carregou');
  assert.equal(await a.pagina.evaluate(() => typeof (window.jspdf && window.jspdf.jsPDF)), 'function', 'jsPDF carregou');
});
