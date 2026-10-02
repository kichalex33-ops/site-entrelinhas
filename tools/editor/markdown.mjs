// Esquema do documento e conversao Markdown <-> documento. Compartilhado pelo editor, pela importacao e pela exportacao:
// assim todos tratam o texto exatamente com as mesmas regras (nao ha "segunda estrutura").
import { Schema } from 'prosemirror-model';
import markdownit from 'markdown-it';
import { schema as esquemaBase, defaultMarkdownParser, defaultMarkdownSerializer, MarkdownParser, MarkdownSerializer } from 'prosemirror-markdown';

// o esquema padrao de Markdown + link interno [[Titulo]] (no inline, atomico)
const noWikilink = {
  inline: true, group: 'inline', atom: true, selectable: true, draggable: false,
  attrs: { titulo: {}, alias: { default: null } },
  leafText: (n) => n.attrs.alias || n.attrs.titulo, // conta como texto nas estatisticas
  toDOM: (n) => ['span', { class: 'st-wikilink', 'data-titulo': n.attrs.titulo, title: 'Link interno: ' + n.attrs.titulo }, n.attrs.alias || n.attrs.titulo],
  parseDOM: [{ tag: 'span.st-wikilink', getAttrs: (dom) => ({ titulo: dom.getAttribute('data-titulo') || dom.textContent, alias: null }) }],
};
export const schema = new Schema({ nodes: esquemaBase.spec.nodes.addToEnd('wikilink', noWikilink), marks: esquemaBase.spec.marks });

// markdown-it: reconhece [[Titulo]] e [[Titulo|alias]] antes do tratamento de links comuns
function pluginWikilink(md) {
  md.inline.ruler.before('link', 'wikilink', (state, silent) => {
    const src = state.src, pos = state.pos;
    if (src.charCodeAt(pos) !== 0x5b || src.charCodeAt(pos + 1) !== 0x5b) return false;
    const fim = src.indexOf(']]', pos + 2);
    if (fim < 0) return false;
    const dentro = src.slice(pos + 2, fim);
    if (!dentro || dentro.length > 150 || /[\n\[\]]/.test(dentro)) return false;
    const [titulo, ...resto] = dentro.split('|');
    if (!titulo.trim()) return false; // valida ANTES de criar o token
    if (!silent) {
      const tok = state.push('wikilink', '', 0);
      tok.content = titulo.trim(); tok.meta = { alias: resto.length ? resto.join('|').trim() : null };
    }
    state.pos = fim + 2;
    return true;
  });
}
const mdIt = markdownit('commonmark', { html: false }).use(pluginWikilink);
const parser = new MarkdownParser(schema, mdIt, { ...defaultMarkdownParser.tokens, wikilink: { node: 'wikilink', getAttrs: (t) => ({ titulo: t.content, alias: (t.meta && t.meta.alias) || null }) } });
const serializer = new MarkdownSerializer({
  ...defaultMarkdownSerializer.nodes,
  wikilink(state, node) { state.write('[[' + node.attrs.titulo + (node.attrs.alias ? '|' + node.attrs.alias : '') + ']]'); }, // sem escapar
}, defaultMarkdownSerializer.marks);

export const parseMarkdown = (md) => parser.parse(md || '') || schema.node('doc', null, [schema.nodes.paragraph.create()]);
export const serializeMarkdown = (doc) => serializer.serialize(doc, { tightLists: true });

const WORD_RE = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;
export const contarPalavras = (texto) => (String(texto || '').match(WORD_RE) || []).length;
export function statsOf(doc) {
  const text = doc.textBetween(0, doc.content.size, '\n', (n) => (n.type.spec.leafText ? n.type.spec.leafText(n) : ' '));
  return { palavras: contarPalavras(text), caracteres: text.replace(/\n/g, '').length };
}

// so http(s) e mailto em links
export const urlSegura = (u) => /^(https?:\/\/|mailto:)/i.test(String(u || '').trim());
