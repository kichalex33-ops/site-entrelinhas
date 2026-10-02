// Editor do Estudio Entrelinhas: ProseMirror com Markdown como formato persistente.
// Este arquivo e a FONTE; o resultado empacotado fica em public/vendor/estudio-editor.js (npm run build:editor).
import { EditorState, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { history, undo, redo } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap, toggleMark, setBlockType, wrapIn, chainCommands, exitCode, lift } from 'prosemirror-commands';
import { wrapInList, splitListItem, liftListItem, sinkListItem } from 'prosemirror-schema-list';
import { inputRules, wrappingInputRule, textblockTypeInputRule, InputRule } from 'prosemirror-inputrules';
import { schema, defaultMarkdownParser, defaultMarkdownSerializer } from 'prosemirror-markdown';

const { strong, em, link } = schema.marks;
const { paragraph, heading, blockquote, bullet_list, ordered_list, list_item, horizontal_rule, hard_break } = schema.nodes;

// ---------- Markdown <-> documento ----------
export const parseMarkdown = (md) => defaultMarkdownParser.parse(md || '') || schema.node('doc', null, [paragraph.create()]);
export const serializeMarkdown = (doc) => defaultMarkdownSerializer.serialize(doc, { tightLists: true });

const WORD_RE = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;
export function statsOf(doc) {
  const text = doc.textBetween(0, doc.content.size, '\n', ' ');
  return { palavras: (text.match(WORD_RE) || []).length, caracteres: text.replace(/\n/g, '').length };
}

// so http(s) e mailto em links
export const urlSegura = (u) => /^(https?:\/\/|mailto:)/i.test(String(u || '').trim());

// ---------- regras de digitacao (atalhos de Markdown) ----------
function markRule(re, markType) {
  return new InputRule(re, (state, match, start, end) => {
    const inner = match[1];
    if (!inner) return null;
    const tr = state.tr;
    let textStart = start + match[0].indexOf(inner);
    let textEnd = textStart + inner.length;
    if (textEnd < end) tr.delete(textEnd, end);
    if (textStart > start) tr.delete(start, textStart);
    textEnd = start + inner.length;
    tr.addMark(start, textEnd, markType.create());
    tr.removeStoredMark(markType);
    return tr;
  });
}

const rules = inputRules({
  rules: [
    textblockTypeInputRule(/^(#{1,3})\s$/, heading, (m) => ({ level: m[1].length })),
    wrappingInputRule(/^\s*>\s$/, blockquote),
    wrappingInputRule(/^\s*([-+*])\s$/, bullet_list),
    wrappingInputRule(/^(\d+)\.\s$/, ordered_list, (m) => ({ order: +m[1] }), (m, node) => node.childCount + node.attrs.order === +m[1]),
    new InputRule(/^---\s$/, (state, _m, start, end) => separadorEm(state.tr.delete(start, end))),
    markRule(/\*\*([^*\n]+)\*\*$/, strong),
    markRule(/(?<![*\w])\*([^*\n]+)\*$/, em),
    markRule(/(?<![_\w])_([^_\n]+)_$/, em),
  ],
});

// Insere um separador de cena e deixa o cursor num paragrafo NOVO logo depois (nunca com o separador selecionado,
// senao a proxima tecla o apagaria).
function separadorEm(tr) {
  const { $from } = tr.selection;
  const vazio = $from.parent.type === paragraph && $from.parent.content.size === 0 && $from.depth === 1;
  const nos = [horizontal_rule.create(), paragraph.create()];
  const pos = vazio ? $from.before() : $from.after($from.depth > 1 ? 1 : $from.depth);
  if (vazio) tr.replaceWith($from.before(), $from.after(), nos); else tr.insert(pos, nos);
  return tr.setSelection(TextSelection.near(tr.doc.resolve(pos + 2))).scrollIntoView();
}

// ---------- comandos ----------
const hardBreak = chainCommands(exitCode, (state, dispatch) => {
  if (dispatch) dispatch(state.tr.replaceSelectionWith(hard_break.create()).scrollIntoView());
  return true;
});

const setHeading = (level) => (state, dispatch) => {
  const { $from } = state.selection;
  if ($from.parent.type === heading && $from.parent.attrs.level === level) return setBlockType(paragraph)(state, dispatch);
  return setBlockType(heading, { level })(state, dispatch);
};
const toggleList = (type) => (state, dispatch) => {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type === type) return liftListItem(list_item)(state, dispatch);
  }
  return wrapInList(type)(state, dispatch);
};
const toggleQuote = (state, dispatch) => {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) if ($from.node(d).type === blockquote) return lift(state, dispatch);
  return wrapIn(blockquote)(state, dispatch);
};
const insertRule = (state, dispatch) => {
  if (dispatch) dispatch(separadorEm(state.tr));
  return true;
};
const setLink = (href) => (state, dispatch) => {
  if (!urlSegura(href)) return false;
  return toggleMark(link, { href: String(href).trim(), title: null })(state, dispatch);
};
const removeLink = (state, dispatch) => toggleMark(link)(state, dispatch);

export const COMMANDS = {
  negrito: toggleMark(strong), italico: toggleMark(em),
  h1: setHeading(1), h2: setHeading(2), h3: setHeading(3),
  lista: toggleList(bullet_list), listaNum: toggleList(ordered_list),
  citacao: toggleQuote, separador: insertRule, removerLink: removeLink,
  desfazer: undo, refazer: redo,
};

const hasMark = (state, type) => {
  const { from, $from, to, empty } = state.selection;
  return empty ? !!type.isInSet(state.storedMarks || $from.marks()) : state.doc.rangeHasMark(from, to, type);
};
const inNode = (state, type, attrs) => {
  const { $from } = state.selection;
  for (let d = $from.depth; d >= 0; d--) {
    const n = $from.node(d);
    if (n.type === type && (!attrs || Object.keys(attrs).every((k) => n.attrs[k] === attrs[k]))) return true;
  }
  return false;
};
function activeInfo(state) {
  return {
    negrito: hasMark(state, strong), italico: hasMark(state, em), link: hasMark(state, link),
    h1: inNode(state, heading, { level: 1 }), h2: inNode(state, heading, { level: 2 }), h3: inNode(state, heading, { level: 3 }),
    lista: inNode(state, bullet_list), listaNum: inNode(state, ordered_list), citacao: inNode(state, blockquote),
  };
}

// ---------- editor ----------
// opcoes: { mount, markdown, onChange(md|null), onStats({palavras,caracteres}), onActive(info), onSelection, editable }
export function createEditor(opts) {
  const plugins = [
    rules,
    history(),
    keymap({
      'Mod-z': undo, 'Mod-y': redo, 'Shift-Mod-z': redo,
      'Mod-b': COMMANDS.negrito, 'Mod-i': COMMANDS.italico,
      'Enter': splitListItem(list_item), 'Tab': sinkListItem(list_item), 'Shift-Tab': liftListItem(list_item),
      'Shift-Enter': hardBreak, 'Mod-Enter': hardBreak,
    }),
    keymap(baseKeymap),
  ];
  const first = EditorState.create({ doc: parseMarkdown(opts.markdown), plugins });
  let view;
  const emit = (state, changed) => {
    if (opts.onStats) opts.onStats(statsOf(state.doc));
    if (opts.onActive) opts.onActive(activeInfo(state));
    if (changed && opts.onChange) opts.onChange();
  };
  view = new EditorView(opts.mount, {
    state: first,
    editable: () => opts.editable !== false,
    attributes: { class: 'estudio-prosa', role: 'textbox', 'aria-multiline': 'true', 'aria-label': 'Texto do documento', spellcheck: 'true', lang: 'pt-BR' },
    dispatchTransaction(tr) {
      const next = view.state.apply(tr);
      view.updateState(next);
      emit(next, tr.docChanged);
    },
    // links so http(s)/mailto: ao colar HTML com outro esquema, o link e descartado
    transformPastedHTML(html) { return html.replace(/href\s*=\s*(["'])\s*(?!https?:|mailto:)[^"']*\1/gi, ''); },
  });
  emit(view.state, false);

  return {
    view,
    getMarkdown: () => serializeMarkdown(view.state.doc),
    setMarkdown(md) {
      const state = EditorState.create({ doc: parseMarkdown(md), plugins });
      view.updateState(state); emit(state, false);
    },
    // estado completo (inclui historico de desfazer) para trocar de aba sem perder nada
    getState: () => view.state,
    setState(state) { view.updateState(state); emit(state, false); },
    createState: (md) => EditorState.create({ doc: parseMarkdown(md), plugins }),
    exec(nome, arg) {
      const cmd = nome === 'link' ? setLink(arg) : COMMANDS[nome];
      if (!cmd) return false;
      const ok = cmd(view.state, view.dispatch.bind(view));
      view.focus();
      return ok;
    },
    selectedText: () => { const { from, to } = view.state.selection; return view.state.doc.textBetween(from, to, ' '); },
    insertText(texto) { view.dispatch(view.state.tr.insertText(texto).scrollIntoView()); view.focus(); },
    focus: () => view.focus(),
    destroy: () => view.destroy(),
    TextSelection,
  };
}
