// Leitura publica (ler.html) e previa da publicacao no Estudio: Markdown -> DOM, sem innerHTML.
// O texto passa pelo markdown-it (HTML desligado) e os tokens viram elementos de uma lista fechada de tags.
// A regra do que e privado ([[links]] e #tags) e a MESMA do servidor: importada de src/leitura.js.
import markdownit from 'markdown-it';
import { limparPrivado } from '../../src/leitura.js';
export { limparPrivado };

const md = markdownit('commonmark', { html: false, linkify: false });
md.disable('image'); // imagens nao entram no texto publico (por enquanto)

const BLOCOS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'ul', 'ol', 'li', 'em', 'strong', 'a', 'code', 'pre']);
const urlSegura = (u) => /^(https?:\/\/|mailto:)/i.test(String(u || '').trim());

function abrir(tok) {
  if (!BLOCOS.has(tok.tag)) return document.createElement('span');
  const el = document.createElement(tok.tag);
  if (tok.tag === 'a') {
    const href = tok.attrGet('href');
    if (urlSegura(href)) { el.href = href; el.target = '_blank'; el.rel = 'noopener noreferrer nofollow'; }
  }
  if (tok.tag === 'ol') { const s = Number(tok.attrGet('start')); if (s > 1) el.start = s; }
  return el;
}

function montar(tokens, raiz) {
  const pilha = [raiz];
  const topo = () => pilha[pilha.length - 1];
  for (const t of tokens) {
    if (t.type === 'inline') { montar(t.children || [], topo()); continue; }
    if (t.nesting === 1) { const el = abrir(t); topo().append(el); pilha.push(el); continue; }
    if (t.nesting === -1) { if (pilha.length > 1) pilha.pop(); continue; }
    switch (t.type) {
      case 'text': topo().append(document.createTextNode(t.content)); break;
      case 'softbreak': topo().append(document.createTextNode('\n')); break;
      case 'hardbreak': topo().append(document.createElement('br')); break;
      case 'hr': { const hr = document.createElement('hr'); hr.className = 'cena'; topo().append(hr); break; }
      case 'code_inline': { const c = document.createElement('code'); c.textContent = t.content; topo().append(c); break; }
      case 'code_block': case 'fence': { const p = document.createElement('pre'); p.textContent = t.content; topo().append(p); break; }
      default: if (t.content) topo().append(document.createTextNode(t.content));
    }
  }
}

// devolve um fragmento com o texto pronto para ler. `privado: true` aplica a limpeza (para a previa no Estudio).
export function renderizar(markdown, { privado = false } = {}) {
  const frag = document.createDocumentFragment();
  montar(md.parse(privado ? limparPrivado(markdown) : String(markdown || ''), {}), frag);
  return frag;
}
