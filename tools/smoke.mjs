// Conferencia rapida depois do deploy: as paginas e APIs principais respondem como esperado.
// Uso: node tools/smoke.mjs https://entrelinhasbr.com.br   (tenta algumas vezes: o deploy leva segundos para propagar)
const base = (process.argv[2] || 'https://entrelinhasbr.com.br').replace(/\/$/, '');

const checagens = [
  ['/', (r, t) => r.status === 200 && t.includes('libraryGrid')],
  ['/api/vitrine', (r, t) => r.status === 200 && Array.isArray(JSON.parse(t).livros)],
  ['/api/authors', (r, t) => r.status === 200 && Array.isArray(JSON.parse(t))],
  ['/api/me', (r) => r.status === 401],
  ['/conta.html', (r) => r.status === 200],
  ['/estudio.html', (r) => r.status === 200],
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
