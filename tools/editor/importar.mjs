// Importacao de manuscritos NO NAVEGADOR (o Worker gratuito tem 10 ms de CPU por requisicao; desmontar DOCX la nao cabe).
// DOCX / TXT / Markdown -> Markdown do Estudio (mesma estrutura do editor) -> capitulos detectados.
// Empacotado em public/vendor/estudio-importar.js e carregado so quando o autor importa.
import mammoth from 'mammoth';
import { DOMParser as DomParserPM } from 'prosemirror-model';
import { schema, parseMarkdown, serializeMarkdown, contarPalavras, urlSegura } from './markdown.mjs';

// separador de cena: "* * *", "***", "---", "# # #", "___"
export const SEPARADOR_RE = /^\s*(?:[*#~=_–—-]\s*){3,}\s*$/;

// ---------------------------------------------------------------- texto
export function decodificarTexto(bytes) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { return new TextDecoder('windows-1252').decode(bytes); } // .txt antigo do Word/Bloco de Notas
}

// .txt: com linhas em branco entre paragrafos, junta linhas quebradas a mao; sem elas, cada linha e um paragrafo
export function textoParaMarkdown(texto) {
  const t = String(texto).replace(/\r\n?/g, '\n').replace(/^﻿/, '');
  const temBrancas = /\n[ \t]*\n/.test(t.trim());
  const blocos = temBrancas ? t.split(/\n[ \t]*\n+/).map((b) => b.replace(/\s*\n\s*/g, ' ').trim()) : t.split('\n').map((l) => l.trim());
  const nos = [];
  for (const b of blocos) {
    if (!b) continue;
    nos.push(SEPARADOR_RE.test(b) ? schema.nodes.horizontal_rule.create() : schema.nodes.paragraph.create(null, schema.text(b)));
  }
  return serializeMarkdown(schema.node('doc', null, nos.length ? nos : [schema.nodes.paragraph.create()]));
}

// .md: passa pelo mesmo parser do editor (normaliza e garante que abrir e salvar nao muda o texto)
export const normalizarMarkdown = (md) => serializeMarkdown(parseMarkdown(String(md).replace(/\r\n?/g, '\n').replace(/^﻿/, '')));

// ---------------------------------------------------------------- docx
const STYLE_MAP = [
  "p[style-name='Title'] => h1:fresh", "p[style-name='Título'] => h1:fresh", "p[style-name='Subtitle'] => h2:fresh", "p[style-name='Subtítulo'] => h2:fresh",
  "p[style-name='Quote'] => blockquote > p:fresh", "p[style-name='Citação'] => blockquote > p:fresh", "p[style-name='Intense Quote'] => blockquote > p:fresh", "p[style-name='Citação Intensa'] => blockquote > p:fresh",
];

export async function docxParaMarkdown(arrayBuffer) {
  const r = await mammoth.convertToHtml({ arrayBuffer }, { styleMap: STYLE_MAP, convertImage: mammoth.images.imgElement(() => Promise.resolve({ src: '' })) });
  const dom = new window.DOMParser().parseFromString('<body>' + r.value + '</body>', 'text/html');
  const imagens = dom.querySelectorAll('img').length;
  dom.querySelectorAll('img').forEach((i) => i.remove());
  // links: so http(s) e mailto; os demais viram texto simples
  dom.querySelectorAll('a').forEach((a) => { if (!urlSegura(a.getAttribute('href'))) a.replaceWith(...a.childNodes); });
  // paragrafo so com "* * *" vira separador de cena
  dom.querySelectorAll('p').forEach((p) => { const t = p.textContent.trim(); if (t.length <= 24 && SEPARADOR_RE.test(t)) p.replaceWith(dom.createElement('hr')); });
  const doc = DomParserPM.fromSchema(schema).parse(dom.body);
  const avisos = [];
  if (imagens) avisos.push(`${imagens} imagem(ns) do arquivo não foram importadas (imagens entram na obra híbrida).`);
  const unicos = new Set(r.messages.filter((m) => m.type === 'warning').map((m) => m.message.replace(/^Unrecognised paragraph style: /, 'Estilo de parágrafo não reconhecido: ')));
  if (unicos.size) avisos.push(`O Word tinha formatação que não foi mantida (${[...unicos].slice(0, 3).join('; ')}${unicos.size > 3 ? '...' : ''}).`);
  return { markdown: serializeMarkdown(doc), avisos };
}

// ---------------------------------------------------------------- capitulos
const NUM = String.raw`(?:\d{1,4}|[ivxlcdm]{1,8}|[a-zçãõáéíóúâêô-]{2,20})`;
const CAP_RE = new RegExp(String.raw`^(?:cap[ií]tulo|cap\.?)\s+${NUM}\b[\s.:–—-]*(.{0,80})$`, 'i');
const ESPECIAL_RE = /^(?:pr[óo]logo|ep[íi]logo|prefácio|prefacio|posf[áa]cio|interl[úu]dio|agradecimentos|dedicat[óo]ria)\b[\s.:–—-]*(.{0,60})$/i;
const PARTE_RE = new RegExp(String.raw`^parte\s+${NUM}\b[\s.:–—-]*(.{0,60})$`, 'i');
const limpar = (l) => l.replace(/^#{1,6}\s+/, '').replace(/^[*_]+|[*_]+$/g, '').replace(/\s+/g, ' ').trim();

function ehTituloPadrao(linha) {
  const t = limpar(linha);
  return t.length > 0 && t.length <= 90 && (CAP_RE.test(t) || ESPECIAL_RE.test(t) || PARTE_RE.test(t));
}

// percorre as linhas ignorando blocos de codigo; devolve { i, linha } dos candidatos a titulo conforme o modo
function titulos(linhas, modo) {
  const out = []; let cerca = false;
  linhas.forEach((l, i) => {
    if (/^\s*(```|~~~)/.test(l)) { cerca = !cerca; return; }
    if (cerca) return;
    const anteriorVazia = i === 0 || !linhas[i - 1].trim();
    if (modo === 'h1' && /^#\s+\S/.test(l)) out.push(i);
    else if (modo === 'h2' && /^##\s+\S/.test(l)) out.push(i);
    else if (modo === 'padrao' && anteriorVazia && ehTituloPadrao(l)) out.push(i);
  });
  return out;
}

export function sugerirModo(md) {
  const linhas = String(md).split('\n');
  const n = (m) => titulos(linhas, m).length;
  if (n('h1') >= 2) return 'h1';
  if (n('padrao') >= 2) return 'padrao';
  if (n('h2') >= 2) return 'h2';
  return 'nenhum';
}

// modo: 'h1' | 'h2' | 'padrao' | 'nenhum'. Retorna [{ titulo, corpo, palavras }]
export function dividirCapitulos(md, modo, tituloUnico = 'Manuscrito') {
  const texto = String(md).replace(/\r\n?/g, '\n').trim();
  const montar = (titulo, linhas) => { const corpo = linhas.join('\n').trim(); return { titulo: (titulo || 'Sem título').slice(0, 200), corpo, palavras: contarPalavras(corpo) }; };
  if (modo === 'nenhum' || !texto) return [montar(tituloUnico, [texto])];
  const linhas = texto.split('\n');
  const idx = titulos(linhas, modo);
  if (!idx.length) return [montar(tituloUnico, linhas)];
  const caps = [];
  const antes = linhas.slice(0, idx[0]);
  if (antes.join('').trim()) caps.push(montar('Abertura', antes));
  idx.forEach((ini, k) => {
    const fim = k + 1 < idx.length ? idx[k + 1] : linhas.length;
    caps.push(montar(limpar(linhas[ini]).replace(/[.:]+$/, ''), linhas.slice(ini + 1, fim)));
  });
  // folha de titulo (so o titulo, sem texto) seguida de varios capitulos: nao e um capitulo
  if (caps.length >= 3 && !caps[0].corpo.trim()) caps.shift();
  return caps;
}

// titulo do livro, quando o arquivo comeca por uma folha de titulo vazia (ex.: estilo "Titulo" do Word)
export function tituloDoLivro(md, modo) {
  const texto = String(md).replace(/\r\n?/g, '\n').trim();
  if (modo === 'nenhum' || !texto) return '';
  const linhas = texto.split('\n');
  const idx = titulos(linhas, modo);
  if (idx.length < 3) return '';
  const primeira = linhas.slice(idx[0] + 1, idx[1]).join('').trim();
  return idx[0] === 0 && !primeira ? limpar(linhas[idx[0]]).slice(0, 200) : '';
}

// ---------------------------------------------------------------- arquivo
const humanizar = (nome) => nome.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Manuscrito importado';

// retorna { nome, tipo, markdown, avisos, titulo }
export async function lerArquivo(arquivo) {
  const ext = (arquivo.name.match(/\.([a-z0-9]+)$/i) || [])[1];
  const tipo = ext && ext.toLowerCase();
  if (!['docx', 'txt', 'md', 'markdown'].includes(tipo)) throw new Error('Formato não aceito. Use DOCX, TXT ou Markdown.');
  if (arquivo.size > 25 * 1024 * 1024) throw new Error('O arquivo é grande demais (máximo de 25 MB).');
  const bytes = await arquivo.arrayBuffer();
  let markdown, avisos = [];
  if (tipo === 'docx') ({ markdown, avisos } = await docxParaMarkdown(bytes));
  else if (tipo === 'txt') markdown = textoParaMarkdown(decodificarTexto(new Uint8Array(bytes)));
  else markdown = normalizarMarkdown(decodificarTexto(new Uint8Array(bytes)));
  if (!markdown.trim()) throw new Error('Não encontramos texto neste arquivo.');
  return { nome: arquivo.name, tipo, markdown, avisos, titulo: humanizar(arquivo.name) };
}
