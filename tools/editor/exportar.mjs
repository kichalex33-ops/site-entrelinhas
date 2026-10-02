// Exportacao NO NAVEGADOR: Markdown, TXT e DOCX. Nada de privado (notas, fichas, pesquisa, [[links]], #tags) vai no manuscrito.
// Empacotado em public/vendor/estudio-exportar.js e carregado so quando o autor exporta.
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, ExternalHyperlink, LevelFormat } from 'docx';
import { parseMarkdown, urlSegura } from './markdown.mjs';

const LINK_RE = /\\?\[\\?\[([^\[\]\n|\\]{1,120})(?:\|([^\[\]\n]*))?\\?\]\\?\]/g;
const HASHTAG_RE = /(^|[\s(>])\\?#[\p{L}][\p{L}\p{N}_-]{1,29}(?![\p{L}\p{N}_-])/gu;
// tag colada na pontuacao ("na margem #resolver."): some junto com o espaco que a antecede
const HASHTAG_ANTES_DE_PONTO_RE = /[ \t]+\\?#[\p{L}][\p{L}\p{N}_-]{1,29}(?![\p{L}\p{N}_-])(?=[.,;:!?)”"'])/gu;

// o que e privado sai do texto: [[Titulo|alias]] vira so o texto; #hashtag some
export function limparParaManuscrito(md) {
  return String(md || '')
    .replace(LINK_RE, (_m, titulo, alias) => (alias || titulo).trim())
    .replace(HASHTAG_ANTES_DE_PONTO_RE, '')
    .replace(HASHTAG_RE, '$1')
    .replace(/[ \t]+$/gm, '').replace(/([^\n\s])[ \t]{2,}(?=\S)/g, '$1 ');
}

// capitulos: [{ titulo, corpo }]  (corpo em Markdown do Estudio)
export function montarMarkdown(capitulos, { titulo, autor } = {}) {
  const partes = [];
  if (titulo) partes.push('# ' + titulo + (autor ? '\n\n*' + autor + '*' : ''));
  for (const c of capitulos) partes.push('## ' + c.titulo + '\n\n' + limparParaManuscrito(c.corpo).trim());
  return partes.join('\n\n') + '\n';
}

// ---------- TXT: texto simples, paragrafos separados por linha em branco, separador de cena "* * *"
function textoSimples(doc) {
  const linhas = [];
  const inline = (no) => { let t = ''; no.forEach((c) => { if (c.isText) t += c.text; else if (c.type.name === 'hard_break') t += '\n'; else if (c.type.spec.leafText) t += c.type.spec.leafText(c); }); return t; };
  const bloco = (no, prefixo = '') => {
    const nome = no.type.name;
    if (nome === 'paragraph' || nome === 'heading' || nome === 'code_block') { const t = inline(no); if (t.trim() || nome !== 'paragraph') linhas.push(prefixo + t); }
    else if (nome === 'horizontal_rule') linhas.push('* * *');
    else if (nome === 'blockquote') no.forEach((c) => bloco(c, prefixo + '    '));
    else if (nome === 'bullet_list') no.forEach((li) => li.forEach((c) => bloco(c, prefixo + '- ')));
    else if (nome === 'ordered_list') { let n = no.attrs.order || 1; no.forEach((li) => { li.forEach((c) => bloco(c, prefixo + (n++) + '. ')); }); }
    else no.forEach((c) => bloco(c, prefixo));
  };
  doc.forEach((n) => bloco(n));
  return linhas.join('\n\n');
}
export function montarTxt(capitulos, { titulo, autor } = {}) {
  const partes = [];
  if (titulo) partes.push(titulo.toUpperCase() + (autor ? '\n' + autor : ''));
  for (const c of capitulos) partes.push(c.titulo.toUpperCase() + '\n\n' + textoSimples(parseMarkdown(limparParaManuscrito(c.corpo))));
  return partes.join('\n\n\n') + '\n';
}

// ---------- DOCX: manuscrito padrao (A4, Times 12, 1,5 de entrelinha, capitulo em pagina nova)
const FONTE = 'Times New Roman';
function runsDe(no, base = {}) {
  const out = [];
  no.forEach((c) => {
    if (c.isText) {
      const m = c.marks.map((x) => x.type.name);
      const link = c.marks.find((x) => x.type.name === 'link');
      const run = new TextRun({ text: c.text, bold: base.bold || m.includes('strong'), italics: base.italics || m.includes('em'), font: m.includes('code') ? 'Courier New' : FONTE, ...(link ? { style: 'Hyperlink' } : {}) });
      out.push(link && urlSegura(link.attrs.href) ? new ExternalHyperlink({ link: link.attrs.href, children: [run] }) : run);
    } else if (c.type.name === 'hard_break') out.push(new TextRun({ break: 1 }));
    else if (c.type.spec.leafText) out.push(new TextRun({ text: c.type.spec.leafText(c), font: FONTE, bold: base.bold, italics: base.italics }));
  });
  return out;
}

function blocosDocx(doc, ctx = { instancia: 0 }, nivel = {}) {
  const out = [];
  const corpo = { line: 360, after: 120 };
  doc.forEach((no) => {
    const nome = no.type.name;
    if (nome === 'paragraph') out.push(new Paragraph({ children: runsDe(no, nivel.base), spacing: corpo, indent: nivel.recuo ? { left: nivel.recuo } : { firstLine: 567 }, ...(nivel.lista ? { numbering: nivel.lista } : {}), ...(nivel.marcador ? { bullet: { level: 0 } } : {}) }));
    else if (nome === 'heading') out.push(new Paragraph({ children: runsDe(no), heading: [null, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4][Math.min(no.attrs.level, 3)] || HeadingLevel.HEADING_2, spacing: { before: 360, after: 160 } }));
    else if (nome === 'horizontal_rule') out.push(new Paragraph({ children: [new TextRun({ text: '* * *', font: FONTE })], alignment: AlignmentType.CENTER, spacing: { before: 240, after: 240 } }));
    else if (nome === 'blockquote') out.push(...blocosDocx(no, ctx, { recuo: 720, base: { italics: true } }));
    else if (nome === 'bullet_list') no.forEach((li) => out.push(...blocosDocx(li, ctx, { ...nivel, marcador: true, recuo: 720 })));
    else if (nome === 'ordered_list') { const inst = ++ctx.instancia; no.forEach((li) => out.push(...blocosDocx(li, ctx, { ...nivel, lista: { reference: 'lista-num', level: 0, instance: inst }, recuo: 720 }))); }
    else if (nome === 'code_block') out.push(new Paragraph({ children: [new TextRun({ text: no.textContent, font: 'Courier New' })], spacing: corpo }));
  });
  return out;
}

export async function gerarDocx(capitulos, { titulo = 'Manuscrito', autor = '' } = {}) {
  const filhos = [
    new Paragraph({ children: [new TextRun({ text: titulo, bold: true, size: 56, font: FONTE })], alignment: AlignmentType.CENTER, spacing: { before: 4200, after: 400 } }),
    ...(autor ? [new Paragraph({ children: [new TextRun({ text: autor, size: 28, font: FONTE })], alignment: AlignmentType.CENTER })] : []),
  ];
  const ctx = { instancia: 0 };
  capitulos.forEach((c) => {
    filhos.push(new Paragraph({ children: [new TextRun({ text: c.titulo, bold: true, size: 32, font: FONTE })], heading: HeadingLevel.HEADING_1, alignment: AlignmentType.CENTER, pageBreakBefore: true, spacing: { before: 1200, after: 480 } }));
    filhos.push(...blocosDocx(parseMarkdown(limparParaManuscrito(c.corpo)), ctx));
  });
  const documento = new Document({
    creator: autor || 'Estúdio Entrelinhas', title: titulo,
    styles: { default: { document: { run: { font: FONTE, size: 24 } } } },
    numbering: { config: [{ reference: 'lista-num', levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.START }] }] },
    sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1418, bottom: 1418, left: 1418, right: 1418 } } }, children: filhos }],
  });
  return Packer.toBlob(documento);
}

export const nomeArquivoSeguro = (t) => String(t || 'manuscrito').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'manuscrito';
