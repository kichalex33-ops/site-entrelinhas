// Conferencia rapida depois do deploy: as paginas e APIs principais respondem como esperado e com os cabecalhos
// de seguranca. So le: nunca cria conta, denuncia, feedback nem nada em producao.
// Uso: node tools/smoke.mjs https://entrelinhasbr.com.br   (tenta algumas vezes: o deploy leva segundos para propagar)
const base = (process.argv[2] || 'https://entrelinhasbr.com.br').replace(/\/$/, '');

const html = (r) => r.status === 200 && /text\/html/.test(r.headers.get('content-type') || '');
// cabecalhos que toda pagina HTML precisa ter (src/index.js: comSeguranca)
const seguro = (r) => /frame-ancestors 'self'/.test(r.headers.get('content-security-policy') || '')
  && !/unsafe-eval/.test(r.headers.get('content-security-policy') || '')
  && r.headers.get('x-content-type-options') === 'nosniff'
  && /max-age=\d+/.test(r.headers.get('strict-transport-security') || '')
  && !!r.headers.get('referrer-policy') && !!r.headers.get('x-robots-tag');
const pagina = (trecho) => (r, t) => html(r) && seguro(r) && t.includes(trecho);

const checagens = [
  ['/', (r, t) => pagina('libraryGrid')(r, t) && t.includes('application/ld+json')],
  ['/autores.html', pagina('id="authors"')],
  ['/leitores.html', pagina('id="leitores"')],
  ['/sobre.html', pagina('contato@entrelinhasbr.com.br')],
  ['/termos.html', pagina('não transfere ao coletivo a propriedade da obra')],
  ['/privacidade.html', pagina('hash PBKDF2')],
  ['/diretrizes.html', pagina('Não proibimos o uso de IA')],
  ['/feedback.html', pagina('id="fb"')],
  ['/conta.html', (r, t) => pagina('id="app"')(r, t) && /noindex/.test(r.headers.get('x-robots-tag') || '')],
  ['/estudio.html', (r, t) => html(r) && seguro(r) && /noindex/.test(r.headers.get('x-robots-tag') || '')],
  ['/editor-capa.html', (r, t) => html(r) && seguro(r) && t.includes('cdnjs.cloudflare.com')],
  ['/visualizador-capa.html', (r, t) => html(r) && seguro(r) && t.includes('three')],
  ['/robots.txt', (r, t) => r.status === 200 && t.includes('Disallow: /api/')],
  ['/sitemap.xml', (r, t) => r.status === 200 && t.includes('<urlset') && t.includes('/termos</loc>')],
  ['/api/vitrine', (r, t) => r.status === 200 && Array.isArray(JSON.parse(t).livros) && r.headers.get('x-content-type-options') === 'nosniff'],
  ['/api/authors', (r, t) => r.status === 200 && Array.isArray(JSON.parse(t))],
  ['/api/leitores', (r, t) => r.status === 200 && Array.isArray(JSON.parse(t))],
  ['/api/me', (r) => r.status === 401],
  ['/vendor/estudio-editor.js', (r) => r.status === 200],
];

let falhas = [];
for (let tentativa = 1; tentativa <= 5; tentativa++) {
  falhas = [];
  for (const [caminho, ok] of checagens) {
    try {
      const r = await fetch(base + caminho + (caminho.includes('?') ? '&' : '?') + 'smoke=' + Date.now(), { redirect: 'follow' });
      const t = await r.text();
      let passou = false;
      try { passou = ok(r, t); } catch { passou = false; }
      if (!passou) falhas.push(`${caminho} -> ${r.status}`);
    } catch (e) { falhas.push(`${caminho} -> ${e.message}`); }
  }
  if (!falhas.length) break;
  console.log(`tentativa ${tentativa}: ${falhas.join(', ')}`);
  await new Promise((ok) => setTimeout(ok, 10000));
}
if (falhas.length) { console.error('Site no ar com problema:\n  ' + falhas.join('\n  ')); process.exit(1); }
console.log(`ok: ${checagens.length} conferencias em ${base}`);
