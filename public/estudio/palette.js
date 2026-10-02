// Busca na obra (Ctrl+K) e paleta de comandos (Ctrl+P). Dialogos acessiveis com lista navegavel por teclado.
import { h, TIPOS_DOC } from './ui.js';

const sem = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// pontuacao "fuzzy": letras da busca em ordem; bonus para sequencia e inicio de palavra. null = nao casa.
export function pontuar(q, texto) {
  const a = sem(q).replace(/\s+/g, ''), t = sem(texto);
  if (!a) return 0;
  let ti = 0, pontos = 0, seguidas = 0;
  for (const c of a) {
    const i = t.indexOf(c, ti);
    if (i < 0) return null;
    seguidas = i === ti ? seguidas + 1 : 0;
    pontos += 1 + seguidas * 2 + (i === 0 || t[i - 1] === ' ' ? 3 : 0) - Math.min(i - ti, 4) * 0.1;
    ti = i + 1;
  }
  return pontos - t.length * 0.01;
}

// marca o trecho encontrado, ignorando acento/caixa (mesmo tamanho de texto)
export function destacar(texto, q) {
  const n = sem(texto), alvo = sem(q).trim();
  const i = alvo.length >= 2 ? n.indexOf(alvo) : -1;
  if (i < 0 || n.length !== texto.length) return document.createTextNode(texto);
  const f = document.createDocumentFragment();
  f.append(texto.slice(0, i), h('mark', null, texto.slice(i, i + alvo.length)), texto.slice(i + alvo.length));
  return f;
}

// Cria um dialogo com campo + lista. `fonte(q)` devolve (ou promete) itens { rotulo, dica, extra, acao }.
function listaNavegavel({ titulo, placeholder, fonte, depois, controles = [], inicial = '' }) {
  const dlg = h('dialog', { class: 'st-dialogo largo st-paleta', 'aria-label': titulo });
  const campo = h('input', { type: 'text', class: 'st-campo', placeholder, 'aria-label': titulo, role: 'combobox', 'aria-expanded': 'true', 'aria-controls': 'st-pal-lista', 'aria-autocomplete': 'list', autocomplete: 'off', value: inicial });
  const lista = h('ul', { id: 'st-pal-lista', role: 'listbox', class: 'st-pal-lista' });
  const vazio = h('p', { class: 'st-pal-vazio', role: 'status' });
  dlg.append(h('div', { class: 'st-pal-topo' }, campo, ...controles.map((c) => c.el)), vazio, lista);
  let itens = [], sel = 0, busca = 0;

  const desenhar = () => {
    lista.replaceChildren(...itens.map((it, i) => h('li', { role: 'option', id: `st-pal-${i}`, class: 'st-pal-item' + (i === sel ? ' sel' : ''), 'aria-selected': i === sel ? 'true' : 'false', onmousedown: (e) => { e.preventDefault(); escolher(i); }, onmousemove: () => { if (sel !== i) { sel = i; marcar(); } } },
      h('span', { class: 'st-pal-rotulo' }, it.rotulo), it.dica ? h('small', { class: 'st-pal-dica' }, it.dica) : null, it.extra || null)));
    campo.setAttribute('aria-activedescendant', itens.length ? `st-pal-${sel}` : '');
  };
  const marcar = () => { [...lista.children].forEach((li, i) => { li.classList.toggle('sel', i === sel); li.setAttribute('aria-selected', i === sel ? 'true' : 'false'); }); campo.setAttribute('aria-activedescendant', `st-pal-${sel}`); const li = lista.children[sel]; if (li) li.scrollIntoView({ block: 'nearest' }); };
  const escolher = (i) => { const it = itens[i]; if (!it) return; dlg.close(); setTimeout(() => it.acao(), 0); };
  const atualizar = async () => {
    const id = ++busca;
    const r = await fonte(campo.value);
    if (id !== busca) return; // resposta antiga
    itens = r.itens; sel = 0; vazio.textContent = r.itens.length ? '' : r.vazio || ''; desenhar();
  };
  let t;
  campo.addEventListener('input', () => { clearTimeout(t); t = setTimeout(atualizar, depois || 0); });
  for (const c of controles) c.el.addEventListener('change', atualizar);
  campo.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (itens.length) { sel = (sel + 1) % itens.length; marcar(); } }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (itens.length) { sel = (sel - 1 + itens.length) % itens.length; marcar(); } }
    else if (e.key === 'Enter') { e.preventDefault(); escolher(sel); }
  });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg); dlg.showModal(); campo.focus(); campo.select(); atualizar();
}

// ctx: { api, obraId(), itens(), tags(), abrirDoc(id), icone(item) }
export function abrirBusca(ctx, inicial = '') {
  const tipo = h('select', { class: 'st-campo st-pal-filtro', 'aria-label': 'Filtrar por tipo' }, h('option', { value: '' }, 'Todos os tipos'), Object.entries(TIPOS_DOC).map(([v, t]) => h('option', { value: v }, t)));
  const tag = h('select', { class: 'st-campo st-pal-filtro', 'aria-label': 'Filtrar por tag' }, h('option', { value: '' }, 'Todas as tags'), ctx.tags().map((t) => h('option', { value: t.tag }, `#${t.tag} (${t.n})`)));
  listaNavegavel({
    titulo: 'Pesquisar na obra', placeholder: 'Pesquisar títulos e textos desta obra...', inicial, depois: 180,
    controles: [{ el: tipo }, { el: tag }],
    fonte: async (q) => {
      const params = new URLSearchParams({ q: q.trim() }); if (tipo.value) params.set('tipo', tipo.value); if (tag.value) params.set('tag', tag.value);
      if (q.trim().length < 2 && !tipo.value && !tag.value) return { itens: [], vazio: 'Digite ao menos 2 letras, ou escolha um tipo ou uma tag.' };
      let r;
      try { r = await ctx.api.buscar(ctx.obraId(), params); } catch (e) { return { itens: [], vazio: e.message }; }
      return {
        vazio: 'Nada encontrado.',
        itens: r.resultados.map((x) => ({
          rotulo: x.titulo, dica: TIPOS_DOC[x.doc_tipo] || '',
          extra: x.trecho ? h('p', { class: 'st-pal-trecho' }, '…', destacar(x.trecho.replace(/\s+/g, ' '), q), '…') : null,
          acao: () => ctx.abrirDoc(x.id),
        })),
      };
    },
  });
}

// comandos: lista de { rotulo, dica, acao }
export function abrirPaleta(ctx, comandos) {
  listaNavegavel({
    titulo: 'Paleta de comandos', placeholder: 'Digite um comando ou o nome de um documento...',
    fonte: (q) => {
      const docs = ctx.itens().filter((i) => i.tipo === 'doc').map((i) => ({ rotulo: i.titulo || 'Sem título', dica: `Abrir · ${TIPOS_DOC[i.doc_tipo] || ''}`, acao: () => ctx.abrirDoc(i.id) }));
      const todos = [...comandos, ...docs];
      if (!q.trim()) return { itens: comandos };
      const r = todos.map((c) => ({ c, p: pontuar(q, c.rotulo) })).filter((x) => x.p !== null).sort((a, b) => b.p - a.p).slice(0, 12).map((x) => x.c);
      return { itens: r, vazio: 'Nenhum comando ou documento encontrado.' };
    },
  });
}
