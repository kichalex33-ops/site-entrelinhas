// Infra dos testes de navegador: roda o Worker REAL (src/index.js) com banco SQLite em memoria,
// serve public/ como arquivos estaticos e controla o Chrome ja instalado via Playwright (sem baixar navegador).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { makeApp } from '../tests/helpers.mjs';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const publico = path.join(raiz, 'public');
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon' };

async function estatico(req) {
  let p = decodeURIComponent(new URL(req.url).pathname);
  if (p.endsWith('/')) p += 'index.html';
  let arq = path.join(publico, p);
  if (!arq.startsWith(publico)) return new Response('Proibido', { status: 403 });
  if (!path.extname(arq) && fs.existsSync(arq + '.html')) arq += '.html';
  if (!fs.existsSync(arq) || fs.statSync(arq).isDirectory()) return new Response('Nao encontrado', { status: 404 });
  return new Response(fs.readFileSync(arq), { headers: { 'Content-Type': TIPOS[path.extname(arq)] || 'application/octet-stream' } });
}

export function acharChrome() {
  const candidatos = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean);
  const achado = candidatos.find((c) => fs.existsSync(c));
  if (!achado) throw new Error('Chrome nao encontrado. Defina CHROME_PATH.');
  return achado;
}

export async function iniciar() {
  const app = makeApp({ ASSETS: { fetch: estatico } });
  const servidor = http.createServer(async (req, res) => {
    try {
      const chunks = []; for await (const c of req) chunks.push(c);
      const corpo = chunks.length ? Buffer.concat(chunks) : undefined;
      const headers = new Headers(); for (const [k, v] of Object.entries(req.headers)) if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(',') : v);
      const r = await app.worker.fetch(new Request('http://127.0.0.1' + req.url, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : corpo }), app.env);
      res.writeHead(r.status, Object.fromEntries(r.headers));
      res.end(Buffer.from(await r.arrayBuffer()));
    } catch (e) { res.writeHead(500); res.end(String(e && e.stack || e)); }
  });
  await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok));
  const url = `http://127.0.0.1:${servidor.address().port}`;
  const navegador = await chromium.launch({ executablePath: acharChrome(), headless: true });

  // contexto de navegador ja logado como um autor novo
  async function novoAutor({ viewport = { width: 1400, height: 860 }, nome = 'Autora E2E' } = {}) {
    const u = app.addUser({ nome });
    const ctx = await navegador.newContext({ viewport, locale: 'pt-BR' });
    await ctx.addCookies([{ name: 'sid', value: u.tok, url }]);
    const pagina = await ctx.newPage();
    const erros = [];
    pagina.on('pageerror', (e) => erros.push('pageerror: ' + e.message));
    pagina.on('console', (m) => { if (m.type() === 'error' && !/favicon|fonts\.g|Failed to load resource.*(404|net::ERR)/.test(m.text())) erros.push('console: ' + m.text()); });
    return { ...u, ctx, pagina, erros };
  }
  const parar = async () => { await navegador.close(); await new Promise((ok) => servidor.close(ok)); };
  return { app, url, navegador, novoAutor, parar };
}
