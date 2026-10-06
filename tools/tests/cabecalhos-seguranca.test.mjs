// Cabecalhos de seguranca em toda resposta; CSP so no HTML, sem unsafe-eval e sem quebrar o que o site carrega de fora.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp } from './helpers.mjs';

const ASSETS = { fetch: async () => new Response('<!doctype html><html><head><title>x</title></head><body></body></html>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } }) };
const pedir = (app, caminho, host = 'entrelinhasbr.com.br') => app.worker.fetch(new Request(`https://${host}${caminho}`, { redirect: 'manual' }), app.env);
const COMUNS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'SAMEORIGIN',
  'strict-transport-security': 'max-age=15552000',
};

test('pagina HTML: CSP com as origens que o site usa, sem unsafe-eval, so o proprio site pode enquadrar', async () => {
  const app = makeApp({ ASSETS });
  const r = await pedir(app, '/termos.html');
  for (const [k, v] of Object.entries(COMUNS)) assert.equal(r.headers.get(k), v, k);
  assert.match(r.headers.get('permissions-policy'), /camera=\(\)/);
  const csp = r.headers.get('content-security-policy');
  assert.ok(csp, 'tem CSP');
  assert.ok(!csp.includes('unsafe-eval'), 'sem unsafe-eval');
  for (const trecho of ["frame-ancestors 'self'", "object-src 'none'", "base-uri 'self'", 'https://fonts.googleapis.com', 'https://fonts.gstatic.com',
    'https://challenges.cloudflare.com', 'https://*.disqus.com', 'https://cdnjs.cloudflare.com', 'https://unpkg.com']) assert.ok(csp.includes(trecho), trecho);
});

test('API, robots e redirecionamento tambem saem com os cabecalhos (CSP so no HTML)', async () => {
  const app = makeApp({ ASSETS });
  for (const caminho of ['/api/authors', '/robots.txt', '/sitemap.xml', '/api/me']) {
    const r = await pedir(app, caminho);
    for (const [k, v] of Object.entries(COMUNS)) assert.equal(r.headers.get(k), v, `${caminho} ${k}`);
    assert.equal(r.headers.get('content-security-policy'), null, `${caminho}: CSP so em HTML`);
  }
  const www = await pedir(app, '/autores', 'www.entrelinhasbr.com.br');
  assert.equal(www.status, 301);
  assert.equal(www.headers.get('location'), 'https://entrelinhasbr.com.br/autores');
  assert.equal(www.headers.get('strict-transport-security'), 'max-age=15552000');
});
