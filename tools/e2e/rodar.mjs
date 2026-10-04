// Roda os testes de navegador: um arquivo por processo, 2 ao mesmo tempo.
// Um arquivo que falha roda de novo UMA vez, sozinho. Se passar, conta como ok, mas fica avisado no fim como instavel;
// se falhar de novo, a suite falha (e o deploy nao acontece).
// Motivo: alguns testes do Estudio estouram o tempo de espera de vez em quando sob carga (sempre um diferente,
// e todos passam sozinhos). Ate achar a causa, isso nao pode travar uma publicacao por acaso.
import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const arquivos = (process.argv.slice(2).length ? process.argv.slice(2) : readdirSync(dir).filter((f) => f.endsWith('.test.mjs')).sort()).map((f) => path.resolve(dir, path.basename(f)));
const PARALELO = 2;

const rodar = (arq) => new Promise((ok) => {
  const p = spawn(process.execPath, ['--no-warnings', '--test', arq], { env: process.env });
  let saida = '';
  p.stdout.on('data', (d) => { saida += d; }); p.stderr.on('data', (d) => { saida += d; });
  p.on('close', (codigo) => ok({ arq, codigo, saida }));
});
const nome = (a) => path.basename(a);
const resumo = (s) => s.split('\n').filter((l) => /^(✔|✖) /.test(l)).join('\n');

const fila = [...arquivos], falhas = [];
await Promise.all(Array.from({ length: PARALELO }, async () => {
  for (let a = fila.shift(); a; a = fila.shift()) {
    const r = await rodar(a);
    console.log(resumo(r.saida));
    if (r.codigo !== 0) falhas.push(r);
  }
}));

const instaveis = [], quebrados = [];
for (const f of falhas) {
  console.log(`\nde novo, sozinho: ${nome(f.arq)}`);
  const r = await rodar(f.arq);
  console.log(resumo(r.saida));
  if (r.codigo === 0) instaveis.push(f); else quebrados.push(r);
}

for (const f of instaveis) {
  console.log(`\n⚠ INSTAVEL (falhou na 1a vez, passou sozinho): ${nome(f.arq)}`);
  console.log(f.saida.split('\n').filter((l) => /✖|Timeout|waiting for|Error/.test(l)).slice(0, 8).join('\n'));
}
for (const r of quebrados) { console.log(`\n✖ FALHOU DUAS VEZES: ${nome(r.arq)}\n${r.saida}`); }
console.log(`\n${arquivos.length} arquivos · ${arquivos.length - falhas.length} ok de primeira · ${instaveis.length} instaveis · ${quebrados.length} quebrados`);
process.exit(quebrados.length ? 1 : 0);
