// Empacota o editor em public/vendor/estudio-editor.js (ESM, minificado). O deploy NAO roda este build:
// o arquivo gerado e versionado, para o site continuar sem etapa de build em producao.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { statSync } from 'node:fs';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const saida = path.join(raiz, 'public', 'vendor', 'estudio-editor.js');

await build({
  entryPoints: [path.join(raiz, 'tools', 'editor', 'entry.mjs')],
  outfile: saida,
  bundle: true,
  format: 'esm',
  minify: true,
  target: ['es2022'],
  legalComments: 'none',
  banner: { js: '/* Estudio Entrelinhas: editor (ProseMirror, MIT). Gerado por tools/editor/build.mjs. Nao edite. */' },
});
console.log('gerado', path.relative(raiz, saida), (statSync(saida).size / 1024).toFixed(1) + ' KB');
