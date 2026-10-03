// Empacota os modulos do Estudio em public/vendor/ (ESM, minificados). O deploy NAO roda este build:
// os arquivos gerados sao versionados, para o site continuar sem etapa de build em producao.
//   estudio-editor.js    editor (carregado sempre que o Estudio abre)
//   estudio-importar.js  DOCX/TXT/Markdown -> capitulos (carregado so ao importar)
//   estudio-exportar.js  Markdown/TXT/DOCX (carregado so ao exportar)
//   estudio-leitura.js   Markdown -> texto para ler (ler.html e previa da publicacao)
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { statSync } from 'node:fs';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const modulos = [['entry.mjs', 'estudio-editor.js'], ['importar.mjs', 'estudio-importar.js'], ['exportar.mjs', 'estudio-exportar.js'], ['leitura.mjs', 'estudio-leitura.js']];

for (const [entrada, saida] of modulos) {
  const arquivo = path.join(raiz, 'public', 'vendor', saida);
  await build({
    entryPoints: [path.join(raiz, 'tools', 'editor', entrada)],
    outfile: arquivo, bundle: true, format: 'esm', minify: true, target: ['es2022'], legalComments: 'none', platform: 'browser',
    banner: { js: `/* Estudio Entrelinhas: ${saida.replace('.js', '')}. Gerado por tools/editor/build.mjs a partir de bibliotecas MIT/BSD. Nao edite. */` },
  });
  console.log('gerado', path.relative(raiz, arquivo), (statSync(arquivo).size / 1024).toFixed(1) + ' KB');
}
