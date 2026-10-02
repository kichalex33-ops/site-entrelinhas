// Estudio Entrelinhas: aplicativo (lista de obras + workspace de escrita).
import { createEditor } from '../vendor/estudio-editor.js';
import { api } from './api.js';
import { criarSalvador, lerBackup, limparBackup } from './autosave.js';
import { h, dialogo, confirmar, perguntar, relativo, dataHora, milhar, TIPOS_OBRA, STATUS_OBRA, TIPOS_DOC } from './ui.js';
import { abrirBusca, abrirPaleta } from './palette.js';
import { importarManuscrito } from './importar-ui.js';
import { abrirExportacao } from './exportar-ui.js';

const raiz = document.getElementById('estudio');
const lsGet = (k, v) => { try { const x = localStorage.getItem(k); return x === null ? v : JSON.parse(x); } catch { return v; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sem armazenamento */ } };

// estado do workspace aberto
let S = null;
let ed = null;      // instancia do editor
let saver = null;   // autosave
let E = {};         // referencias de DOM do workspace

// ============================================================== roteamento
function rota() {
  const m = location.hash.match(/^#\/obra\/([a-f0-9]{12})(?:\/([a-f0-9]{12}))?$/);
  return m ? { obra: m[1], doc: m[2] || null } : { obra: null };
}

async function iniciar() {
  if (saver) await saver.todos().catch(() => {});
  fecharWorkspace();
  let eu;
  try { eu = await api.me(); } catch (e) { return telaMensagem('Entre na sua conta', 'O Estúdio é o espaço privado de criação dos autores.', h('a', { class: 'btn btn-primary', href: 'conta.html' }, 'Entrar')); }
  if (eu.role !== 'autor') return telaMensagem('Apenas para autores', 'O Estúdio é exclusivo de contas de autor.', h('a', { class: 'btn btn-ghost', href: 'autores.html' }, 'Ver autores'));
  const r = rota();
  if (r.obra) return abrirObra(r.obra, r.doc);
  return telaInicio();
}

function telaMensagem(titulo, texto, acao) {
  document.body.classList.remove('st-workspace');
  raiz.replaceChildren(h('section', { class: 'page active' }, h('div', { class: 'hero' }, h('span', { class: 'eyebrow' }, 'Estúdio Entrelinhas'), h('h2', null, titulo), h('p', null, texto), h('p', { class: 'cta-row' }, acao))));
}

// ============================================================== lista de obras
async function telaInicio() {
  document.body.classList.remove('st-workspace');
  document.title = 'Estúdio | Entrelinhas';
  raiz.replaceChildren(h('p', { class: 'muted-note' }, 'Carregando suas obras...'));
  let obras;
  try { obras = (await api.obras()).obras; } catch (e) { return telaMensagem('Não foi possível carregar', e.message, h('button', { class: 'btn btn-ghost', onclick: iniciar }, 'Tentar de novo')); }

  const grupo = (titulo, lista, id) => lista.length ? h('section', { class: 'st-grupo', 'aria-labelledby': id }, h('h3', { id }, titulo), h('div', { class: 'st-cards' }, lista.map(cartao))) : null;
  const por = (...st) => obras.filter((o) => st.includes(o.status));
  raiz.replaceChildren(h('section', { class: 'page active st-inicio' },
    h('div', { class: 'hero', style: 'padding-bottom:.5rem' },
      h('span', { class: 'eyebrow' }, 'Espaço privado de criação'), h('h2', null, 'Estúdio ', h('em', null, 'Entrelinhas')),
      h('p', null, 'Pense, conecte, escreva, organize e revise. Nada aqui aparece para os leitores até você escolher publicar.'),
      h('p', { class: 'cta-row' }, h('button', { class: 'btn btn-primary', id: 'st-nova', onclick: novaObra }, '+ Nova obra'))),
    obras.length ? [
      grupo('Obras recentes', obras.slice(0, 6), 'g-rec'),
      grupo('Rascunhos', por('rascunho'), 'g-ras'), grupo('Em revisão', por('em_revisao'), 'g-rev'),
      grupo('Agendadas', por('agendado'), 'g-age'), grupo('Publicadas', por('publicado', 'atualizado'), 'g-pub'), grupo('Arquivadas', por('arquivado'), 'g-arq'),
    ] : h('p', { class: 'muted-note' }, 'Você ainda não tem obras no Estúdio. Comece por “+ Nova obra”.')));
}

function cartao(o) {
  const prog = o.progresso === null ? null : h('div', { class: 'st-prog', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(o.progresso * 100)), 'aria-label': 'Progresso da meta de palavras' }, h('span', { style: `width:${Math.round(o.progresso * 100)}%` }));
  return h('article', { class: 'st-card', dataset: { obra: o.id } },
    h('h4', null, h('a', { href: `#/obra/${o.id}` }, o.titulo)),
    h('p', { class: 'st-meta' }, `${TIPOS_OBRA[o.tipo] || o.tipo} · `, h('span', { class: 'st-pilula' }, STATUS_OBRA[o.status] || o.status)),
    h('p', { class: 'st-meta' }, `${milhar(o.palavras)} palavras · ${o.docs} documento${o.docs === 1 ? '' : 's'}`),
    prog,
    h('p', { class: 'st-meta' }, `Última alteração ${relativo(o.atualizada_em)}`),
    h('div', { class: 'st-card-acoes' },
      h('a', { class: 'btn btn-ghost', href: `#/obra/${o.id}` }, 'Abrir'),
      h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => excluirObra(o) }, 'Excluir')));
}

async function excluirObra(o) {
  if (!(await confirmar('Excluir esta obra?', `“${o.titulo}” vai para a lixeira de obras. Você pode restaurá-la depois.`, 'Excluir', true))) return;
  try { await api.excluirObra(o.id); } catch (e) { return dialogo({ titulo: 'Não foi possível excluir', corpo: h('p', null, e.message) }); }
  telaInicio();
}

async function novaObra() {
  const comecar = (tipo, rotulo) => async () => {
    dlg.close();
    const titulo = await perguntar('Como se chama a obra?', 'Título', '', 'Criar obra');
    if (!titulo) return;
    try { const r = await api.criarObra(titulo, tipo); location.hash = `#/obra/${r.id}`; }
    catch (e) { dialogo({ titulo: 'Não foi possível criar a obra', corpo: h('p', null, e.message) }); }
  };
  const opcao = (titulo, texto, acao, off) => h('button', { type: 'button', class: 'st-opcao', disabled: off || null, onclick: acao }, h('strong', null, titulo), h('span', null, texto));
  const importarNova = async () => {
    dlg.close();
    const r = await importarManuscrito({});
    if (r && r.obraId) location.hash = '#/obra/' + r.obraId + (r.primeiro ? '/' + r.primeiro : '');
  };
  let dlg;
  dlg = h('dialog', { class: 'st-dialogo', 'aria-labelledby': 'st-nova-t' },
    h('h2', { id: 'st-nova-t' }, 'Como deseja começar?'),
    h('div', { class: 'st-opcoes' },
      opcao('Escrever no Entrelinhas', 'Um workspace de texto com capítulos, personagens, mundo e notas.', comecar('texto')),
      opcao('Importar manuscrito', 'Traga um arquivo DOCX, TXT ou Markdown e transforme em capítulos editáveis.', importarNova),
      opcao('Criar / enviar HQ', 'Páginas, roteiro, personagens e referências para quadrinhos.', comecar('hq'))),
    h('div', { class: 'st-dialogo-rodape' }, h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => dlg.close() }, 'Cancelar')));
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg); dlg.showModal();
}

// ============================================================== workspace
function fecharWorkspace() {
  if (ed) { try { ed.destroy(); } catch { /* ja destruido */ } }
  document.removeEventListener('keydown', atalhos);
  ed = null; saver = null; S = null; E = {};
  document.body.classList.remove('st-workspace', 'st-foco');
}

async function abrirObra(obraId, docInicial) {
  document.body.classList.add('st-workspace');
  raiz.replaceChildren(h('p', { class: 'muted-note' }, 'Abrindo a obra...'));
  let r;
  try { r = await api.obra(obraId); }
  catch (e) { return telaMensagem(e.status === 404 ? 'Obra não encontrada' : 'Não foi possível abrir a obra', e.status === 404 ? 'Ela não existe ou não é sua.' : e.message, h('a', { class: 'btn btn-primary', href: '#/' }, 'Voltar ao Estúdio')); }

  S = { obraId, obra: r.obra, itens: r.itens, tags: r.tags || [], filtroTag: null, docs: new Map(), abas: [], ativa: null, expandidas: new Set(lsGet(`estudio:arvore:${obraId}`, null) || r.itens.filter((i) => i.tipo === 'pasta').map((i) => i.id)) };
  document.title = `${r.obra.titulo} | Estúdio`;
  montarWorkspace();
  const abas = lsGet(`estudio:abas:${obraId}`, { abas: [], ativa: null });
  const ids = [...new Set([...(docInicial ? [docInicial] : []), ...abas.abas])].filter((id) => S.itens.some((i) => i.id === id && i.tipo === 'doc'));
  for (const id of ids.slice(0, 8)) await abrirDoc(id, { ativar: false });
  const alvo = docInicial && S.docs.has(docInicial) ? docInicial : S.docs.has(abas.ativa) ? abas.ativa : S.abas[0];
  if (alvo) ativar(alvo); else mostrarVazio();
}

function montarWorkspace() {
  const btn = (nome, rotulo, simbolo, extra) => h('button', { type: 'button', class: 'st-tb', 'aria-label': rotulo, title: rotulo, 'aria-pressed': 'false', dataset: { cmd: nome }, ...(extra || {}) }, simbolo);
  E.explorador = h('aside', { class: 'st-explorador', 'aria-label': 'Estrutura da obra' });
  E.contexto = h('aside', { class: 'st-contexto', 'aria-label': 'Contexto do documento' });
  E.abas = h('div', { class: 'st-abas', role: 'tablist', 'aria-label': 'Documentos abertos' });
  E.titulo = h('input', { class: 'st-titulo', type: 'text', maxlength: '200', 'aria-label': 'Título do documento', placeholder: 'Título', oninput: aoMudarTitulo });
  E.tipo = h('select', { class: 'st-tipo', 'aria-label': 'Tipo do documento', onchange: aoMudarTipo }, Object.entries(TIPOS_DOC).map(([v, t]) => h('option', { value: v }, t)));
  E.modoBtn = h('button', { type: 'button', class: 'btn btn-ghost st-modo', onclick: alternarModo, 'aria-label': 'Alternar entre modo visual e Markdown' }, 'Markdown');
  E.toolbar = h('div', { class: 'st-toolbar', role: 'toolbar', 'aria-label': 'Formatação' },
    btn('negrito', 'Negrito (Ctrl+B)', h('b', null, 'N')), btn('italico', 'Itálico (Ctrl+I)', h('i', null, 'I')),
    h('span', { class: 'st-sep' }),
    btn('h1', 'Título 1', 'T1'), btn('h2', 'Título 2', 'T2'), btn('h3', 'Título 3', 'T3'),
    h('span', { class: 'st-sep' }),
    btn('lista', 'Lista', '•'), btn('listaNum', 'Lista numerada', '1.'), btn('citacao', 'Citação', '“'), btn('separador', 'Separador de cena', '⁂'),
    btn('link', 'Link (selecione o texto)', '🔗'),
    h('span', { class: 'st-sep' }),
    btn('desfazer', 'Desfazer (Ctrl+Z)', '↶'), btn('refazer', 'Refazer (Ctrl+Y)', '↷'));
  E.toolbar.addEventListener('mousedown', (e) => e.preventDefault()); // nao tirar o foco do texto
  E.toolbar.addEventListener('click', aoClicarFerramenta);
  E.mount = h('div', { class: 'st-pm' });
  E.md = h('textarea', { class: 'st-md', spellcheck: 'true', lang: 'pt-BR', 'aria-label': 'Texto em Markdown', hidden: true, oninput: () => { const d = docAtivo(); if (d) { saver.marcar(d); atualizarStatsMd(); renderAbas(); } } });
  E.vazio = h('div', { class: 'st-vazio', hidden: true }, h('p', null, 'Nenhum documento aberto.'), h('p', { class: 'hint' }, 'Escolha um item no explorador ou crie um capítulo.'));
  E.stats = h('span', { class: 'st-stats', 'aria-live': 'off' });
  E.estado = h('span', { class: 'st-estado', role: 'status', 'aria-live': 'polite', dataset: { estado: 'salvo' } }, 'Salvo');
  E.edDocbar = h('div', { class: 'st-docbar' }, E.titulo, E.tipo, E.modoBtn);
  E.superficie = h('div', { class: 'st-superficie' }, E.mount, E.md, E.vazio);

  E.barTitulo = h('span', { class: 'st-bar-titulo' }, S.obra.titulo);
  const barra = h('header', { class: 'st-bar' },
    h('button', { type: 'button', class: 'st-tb', id: 'st-tg-exp', 'aria-label': 'Mostrar ou esconder o explorador', 'aria-pressed': 'true', onclick: () => alternarPainel('exp') }, '☰'),
    h('a', { class: 'st-bar-voltar', href: '#/' }, 'Estúdio'), h('span', { class: 'st-bar-sep', 'aria-hidden': 'true' }, '/'), E.barTitulo,
    h('span', { class: 'st-bar-espaco' }),
    h('button', { type: 'button', class: 'btn btn-ghost st-bar-btn', onclick: dialogoObra }, 'Obra'),
    h('button', { type: 'button', class: 'btn btn-ghost st-bar-btn', onclick: exportarObra }, 'Exportar'),
    h('button', { type: 'button', class: 'btn btn-ghost st-bar-btn', onclick: dialogoLixeira }, 'Lixeira'),
    h('button', { type: 'button', class: 'btn btn-ghost st-bar-btn', id: 'st-foco-btn', onclick: alternarFoco, title: 'Modo foco (Ctrl+Shift+F)' }, 'Modo foco'),
    h('button', { type: 'button', class: 'st-tb', id: 'st-tg-ctx', 'aria-label': 'Mostrar ou esconder o contexto', 'aria-pressed': 'true', onclick: () => alternarPainel('ctx') }, 'ⓘ'));

  const editor = h('section', { class: 'st-editor', 'aria-label': 'Editor' }, E.abas, E.edDocbar, E.toolbar, E.superficie, h('div', { class: 'st-status' }, E.stats, E.estado));
  E.main = h('div', { class: 'st-main' },
    E.explorador, h('div', { class: 'st-resizer', dataset: { lado: 'esq' }, role: 'separator', 'aria-orientation': 'vertical', 'aria-label': 'Redimensionar o explorador', tabindex: '0' }),
    editor,
    h('div', { class: 'st-resizer', dataset: { lado: 'dir' }, role: 'separator', 'aria-orientation': 'vertical', 'aria-label': 'Redimensionar o contexto', tabindex: '0' }), E.contexto);
  E.chipFoco = h('button', { type: 'button', class: 'st-chip-foco', onclick: alternarFoco }, 'Sair do modo foco (Esc)');
  raiz.replaceChildren(h('div', { class: 'st-app' }, barra, E.main, E.chipFoco));

  const larg = lsGet('estudio:larguras', { esq: 270, dir: 290 });
  E.main.style.setProperty('--st-esq', larg.esq + 'px'); E.main.style.setProperty('--st-dir', larg.dir + 'px');
  const paineis = lsGet('estudio:paineis', { exp: true, ctx: true });
  E.main.dataset.exp = window.innerWidth < 900 ? 'false' : String(paineis.exp);
  E.main.dataset.ctx = window.innerWidth < 900 ? 'false' : String(paineis.ctx);
  sincronizarPaineis();
  prepararRedimensionar();

  ed = createEditor({
    mount: E.mount, markdown: '',
    onChange: () => { const d = docAtivo(); if (d) { saver.marcar(d); renderAbas(); } },
    onStats: (s) => { E.stats.textContent = `Palavras: ${milhar(s.palavras)} · Caracteres: ${milhar(s.caracteres)}`; atualizarContextoStats(s); },
    onActive: (info) => { for (const b of E.toolbar.querySelectorAll('[data-cmd]')) b.setAttribute('aria-pressed', info[b.dataset.cmd] ? 'true' : 'false'); },
    onLinkQuery: aoConsultaLink, linkAberto: () => !!pop, onLinkTecla: teclaPopLink,
    existeTitulo: (t) => S.itens.some((i) => i.tipo === 'doc' && norm(i.titulo) === norm(t)),
    onAbrirLink: abrirPorTitulo,
  });
  saver = criarSalvador({
    obraId: S.obraId,
    corpoDe: corpoDe,
    aoMudarEstado: (g) => { E.estado.textContent = g.texto; E.estado.dataset.estado = g.estado; renderAbas(); },
    aoConflito: resolverConflito,
    aoSalvo: (doc, r, corpo) => {
      const it = S.itens.find((i) => i.id === doc.id);
      if (it) { it.versao = r.versao; it.palavras = r.palavras; it.titulo = doc.titulo; it.doc_tipo = doc.tipo; }
      const ht = hashtagsDe(corpo); // #hashtags do texto mudaram? atualiza as tags vindas do servidor
      if (JSON.stringify(ht) !== JSON.stringify(doc.tagsTexto)) { doc.tagsTexto = ht; recarregarTags(); } else renderContexto();
      agendarConexoes(600);
    },
  });
  renderExplorador(); renderAbas(); renderContexto();
  document.addEventListener('keydown', atalhos);
}

const docAtivo = () => (S && S.ativa ? S.docs.get(S.ativa) : null);
function corpoDe(doc) {
  if (S && doc.id === S.ativa) return doc.modo === 'md' ? E.md.value : ed.getMarkdown();
  return doc.md;
}
function guardarAtivo() { // congela o estado do documento atual antes de trocar de aba
  const d = docAtivo(); if (!d) return;
  d.md = corpoDe(d);
  if (d.modo !== 'md') d.edState = ed.getState();
}

// ============================================================== documentos e abas
async function abrirDoc(id, { ativar: ir = true } = {}) {
  if (!S.docs.has(id)) {
    let d;
    try { d = await api.doc(S.obraId, id); } catch (e) { if (ir) dialogo({ titulo: 'Não foi possível abrir', corpo: h('p', null, e.message) }); return; }
    const doc = { id, pai: d.pai, versao: d.versao, titulo: d.titulo, tipo: d.doc_tipo, md: d.corpo, palavras: d.palavras, atualizadoEm: d.atualizado_em, modo: 'visual', dirty: false, rev: 0, estado: 'salvo', tagsTexto: hashtagsDe(d.corpo) };
    doc.edState = ed.createState(d.corpo);
    S.docs.set(id, doc); saver.acompanhar(doc);
    await recuperar(doc, d);
  }
  if (!S.abas.includes(id)) S.abas.push(id);
  if (ir) ativar(id); else renderAbas();
}

// copia local de emergencia: se sobrou algo nao confirmado pelo servidor, oferece recuperar
async function recuperar(doc, servidor) {
  const b = lerBackup(doc.id);
  if (!b || (b.corpo === servidor.corpo && b.titulo === servidor.titulo)) { limparBackup(doc.id); return; }
  const aplicar = (base) => { doc.versao = base; doc.titulo = b.titulo || doc.titulo; doc.tipo = b.tipo || doc.tipo; doc.md = b.corpo; doc.edState = ed.createState(b.corpo); saver.marcar(doc); };
  if (b.versao_base === servidor.versao) { aplicar(servidor.versao); avisar('Recuperamos alterações não salvas desta obra. Elas serão salvas agora.'); return; }
  const v = await dialogo({
    titulo: 'Encontramos texto não salvo',
    corpo: [h('p', null, `Há uma cópia local de “${b.titulo}” de ${dataHora(Math.floor(b.em / 1000))}, mas o documento foi alterado depois, em outro lugar.`), h('p', { class: 'hint' }, 'Nenhuma das duas versões será apagada sem a sua escolha.')],
    botoes: [{ rotulo: 'Manter a do servidor', valor: 'servidor' }, { rotulo: 'Guardar a local como nova nota', valor: 'copia' }, { rotulo: 'Usar a minha cópia local', valor: 'local', classe: 'btn-primary' }],
  });
  if (v === 'local') aplicar(servidor.versao);
  else if (v === 'copia') { await criarNotaDeTexto(`${b.titulo} (recuperado)`, b.corpo, doc.pai); limparBackup(doc.id); }
  else if (v === 'servidor') limparBackup(doc.id);
  // v === null (Esc): mantem a copia local no aparelho para a proxima abertura
}

function ativar(id) {
  const anterior = docAtivo();
  if (anterior && anterior.id !== id) guardarAtivo();
  const doc = S.docs.get(id); if (!doc) return;
  S.ativa = id; fecharPop();
  E.vazio.hidden = true;
  E.edDocbar.hidden = false; E.toolbar.hidden = false;
  E.titulo.value = doc.titulo; E.tipo.value = doc.tipo;
  mostrarModo(doc);
  history.replaceState(null, '', `#/obra/${S.obraId}/${id}`);
  lsSet(`estudio:abas:${S.obraId}`, { abas: S.abas, ativa: id });
  renderAbas(); renderExplorador(); renderContexto(); agendarConexoes(0);
}

function mostrarModo(doc) {
  const md = doc.modo === 'md';
  E.mount.hidden = md; E.md.hidden = !md; E.toolbar.classList.toggle('desligada', md);
  E.modoBtn.textContent = md ? 'Visual' : 'Markdown';
  if (md) { E.md.value = doc.md; atualizarStatsMd(); }
  else { ed.setState(doc.edState); }
}

function alternarModo() {
  const d = docAtivo(); if (!d) return;
  if (d.modo === 'md') { d.edState = ed.createState(E.md.value); d.md = E.md.value; d.modo = 'visual'; }
  else { d.md = ed.getMarkdown(); d.modo = 'md'; }
  mostrarModo(d);
  if (d.modo === 'visual') ed.focus(); else E.md.focus();
}
function atualizarStatsMd() {
  const t = E.md.value; const p = (t.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) || []).length;
  E.stats.textContent = `Palavras: ${milhar(p)} · Caracteres: ${milhar(t.replace(/\n/g, '').length)}`;
}

function mostrarVazio() {
  S.ativa = null; E.vazio.hidden = false; E.mount.hidden = true; E.md.hidden = true; E.edDocbar.hidden = true; E.toolbar.hidden = true;
  E.stats.textContent = ''; history.replaceState(null, '', `#/obra/${S.obraId}`); renderAbas(); renderExplorador(); renderContexto();
}

function renderAbas() {
  if (!S) return;
  E.abas.replaceChildren(...S.abas.map((id) => {
    const doc = S.docs.get(id); if (!doc) return null;
    const ativa = id === S.ativa;
    return h('div', { class: 'st-aba' + (ativa ? ' ativa' : ''), role: 'presentation' },
      h('button', { type: 'button', role: 'tab', 'aria-selected': ativa ? 'true' : 'false', class: 'st-aba-nome', onclick: () => ativar(id), title: doc.titulo },
        doc.titulo || 'Sem título', doc.dirty ? h('span', { class: 'st-sujo', 'aria-label': 'alterações ainda não salvas' }, ' •') : null),
      h('button', { type: 'button', class: 'st-aba-fechar', 'aria-label': `Fechar ${doc.titulo}`, onclick: () => fecharAba(id) }, '×'));
  }));
}

async function fecharAba(id) {
  const doc = S.docs.get(id);
  if (doc && doc.dirty) { if (id === S.ativa) guardarAtivo(); await saver.salvar(doc); }
  if (doc && doc.dirty && doc.estado !== 'salvo') {
    if (!(await confirmar('Fechar sem salvar?', 'Este documento ainda não foi salvo no servidor (há uma cópia no seu aparelho).', 'Fechar mesmo assim', true))) return;
  }
  if (doc) saver.esquecer(doc);
  S.docs.delete(id);
  const i = S.abas.indexOf(id); S.abas.splice(i, 1);
  if (id === S.ativa) { S.ativa = null; const prox = S.abas[Math.min(i, S.abas.length - 1)]; if (prox) ativar(prox); else mostrarVazio(); }
  else { lsSet(`estudio:abas:${S.obraId}`, { abas: S.abas, ativa: S.ativa }); renderAbas(); }
}

function aoMudarTitulo() {
  const d = docAtivo(); if (!d) return;
  d.titulo = E.titulo.value; saver.marcar(d); renderAbas();
  const it = S.itens.find((i) => i.id === d.id); if (it) { it.titulo = d.titulo; renderExplorador(); }
}
function aoMudarTipo() {
  const d = docAtivo(); if (!d) return;
  d.tipo = E.tipo.value; saver.marcar(d);
  const it = S.itens.find((i) => i.id === d.id); if (it) it.doc_tipo = d.tipo;
  renderExplorador(); renderContexto();
}

async function aoClicarFerramenta(e) {
  const b = e.target.closest('[data-cmd]'); if (!b || !docAtivo() || docAtivo().modo === 'md') return;
  const cmd = b.dataset.cmd;
  if (cmd === 'link') {
    if (!ed.selectedText()) return dialogo({ titulo: 'Inserir link', corpo: h('p', null, 'Selecione primeiro o trecho de texto que vai virar o link.') });
    const url = await perguntar('Inserir link', 'Endereço (começa com https://)', 'https://', 'Inserir');
    if (url && !ed.exec('link', url)) dialogo({ titulo: 'Endereço não permitido', corpo: h('p', null, 'Use um endereço que comece com http://, https:// ou mailto:.') });
    return;
  }
  ed.exec(cmd);
}

// ============================================================== conflito de edicao
async function resolverConflito(doc, atual) {
  const v = await dialogo({
    titulo: 'Este documento mudou em outro lugar',
    corpo: [h('p', null, `“${doc.titulo}” foi salvo em outro aparelho ou aba depois da última vez que você o abriu aqui.`), h('p', { class: 'hint' }, 'Escolha com calma: nenhuma versão será apagada sem a sua decisão.')],
    botoes: [
      { rotulo: 'Usar a versão do servidor', valor: 'servidor' },
      { rotulo: 'Guardar a minha como cópia', valor: 'copia' },
      { rotulo: 'Manter a minha versão', valor: 'minha', classe: 'btn-primary' },
    ],
  });
  if (v === 'minha') { doc.versao = atual.versao; saver.liberar(doc); return; }
  const aplicarServidor = () => {
    doc.versao = atual.versao; doc.titulo = atual.titulo; doc.md = atual.corpo; doc.edState = ed.createState(atual.corpo); doc.dirty = false; doc.estado = 'salvo'; doc.rev++;
    limparBackup(doc.id); saver.esquecer(doc); saver.acompanhar(doc);
    const it = S.itens.find((i) => i.id === doc.id); if (it) { it.titulo = doc.titulo; it.versao = doc.versao; }
    if (S.ativa === doc.id) { E.titulo.value = doc.titulo; mostrarModo(doc); }
    renderAbas(); renderExplorador();
  };
  if (v === 'copia') { await criarNotaDeTexto(`${doc.titulo} (minha versão)`, corpoDe(doc), doc.pai); aplicarServidor(); return; }
  if (v === 'servidor') { aplicarServidor(); return; }
  // Esc: continua em conflito (nao salva); o texto segue protegido na copia local
  doc.estado = 'conflito'; saver.acompanhar(doc);
}

async function criarNotaDeTexto(titulo, corpo, pai) {
  try {
    const r = await api.criarDoc(S.obraId, { pai: pai || null, doc_tipo: 'nota', titulo, corpo });
    S.itens.push({ id: r.id, pai: pai || null, tipo: 'doc', doc_tipo: 'nota', titulo, posicao: r.posicao, versao: r.versao, palavras: 0 });
    renderExplorador(); avisar(`Criamos a nota “${titulo}”.`);
  } catch (e) { dialogo({ titulo: 'Não foi possível guardar a cópia', corpo: h('p', null, e.message) }); }
}

// ============================================================== explorador
const ICONES = { pasta: '▸', manuscrito: '✎', personagens: '☺', mundo: '◎', pesquisa: '⌕', ideias: '✦', descartadas: '✂', capitulo: '§', cena: '¶', personagem: '☺', lugar: '◎', objeto: '◆', evento: '⌛', pesquisa_doc: '⌕', nota: '≡' };
const iconeDe = (it) => (it.tipo === 'pasta' ? ICONES[it.doc_tipo] || '▸' : ICONES[it.doc_tipo === 'pesquisa' ? 'pesquisa_doc' : it.doc_tipo] || '≡');
const PADROES = { manuscrito: ['capitulo', 'Capítulo'], personagens: ['personagem', 'Personagem'], mundo: ['lugar', 'Lugar'], pesquisa: ['pesquisa', 'Pesquisa'], ideias: ['nota', 'Ideia'], descartadas: ['cena', 'Cena'] };

const filhosDe = (pai) => S.itens.filter((i) => (i.pai || null) === (pai || null)).sort((a, b) => a.posicao - b.posicao);
// filtro por tag: mostra so os documentos com a tag e as pastas que os contem
const visivel = (it) => !S.filtroTag || (it.tipo === 'doc' ? (it.tags || []).includes(S.filtroTag) : S.itens.some((x) => x.pai === it.id && visivel(x)));
const filhosVisiveis = (pai) => filhosDe(pai).filter(visivel);
function filtroTags() {
  if (!S.tags.length) return null;
  return h('label', { class: 'st-filtro' }, h('span', null, 'Filtrar por tag'),
    h('select', { 'aria-label': 'Filtrar documentos por tag', onchange: (e) => { S.filtroTag = e.target.value || null; renderExplorador(); } },
      h('option', { value: '' }, 'Todas'), S.tags.map((t) => h('option', { value: t.tag, selected: t.tag === S.filtroTag }, `#${t.tag} (${t.n})`))));
}

function renderExplorador() {
  if (!S || !E.explorador) return;
  const foco = document.activeElement && E.explorador.contains(document.activeElement) ? document.activeElement.dataset.id : null;
  const nivel = (pai, n) => h('ul', { role: n === 1 ? 'tree' : 'group', class: 'st-arvore' }, filhosVisiveis(pai).map((it) => no(it, n)));
  E.explorador.replaceChildren(
    h('div', { class: 'st-exp-topo' }, h('h2', null, 'Estrutura'),
      h('span', { class: 'st-exp-acoes' },
        h('button', { type: 'button', class: 'st-tb', 'aria-label': 'Nova nota na raiz da obra', title: 'Nova nota', onclick: () => criarItem(null, 'doc', 'nota') }, '＋'),
        h('button', { type: 'button', class: 'st-tb', 'aria-label': 'Nova pasta', title: 'Nova pasta', onclick: () => criarItem(null, 'pasta') }, '🗀'))),
    h('p', { class: 'st-exp-obra' }, S.obra.titulo),
    filtroTags(),
    nivel(null, 1),
    h('p', { class: 'hint st-exp-dica' }, 'Arraste para reorganizar. F2 renomeia, Delete envia para a lixeira.'));
  if (foco) { const el = E.explorador.querySelector(`[data-id="${foco}"]`); if (el) el.focus(); }
  agendarDecoracao();
}

function no(it, n) {
  const pasta = it.tipo === 'pasta';
  const aberta = S.filtroTag ? true : S.expandidas.has(it.id);
  const li = h('li', { role: 'treeitem', 'aria-level': String(n), 'aria-expanded': pasta ? String(aberta) : null, 'aria-selected': it.id === S.ativa ? 'true' : 'false', dataset: { id: it.id } });
  const acoes = h('span', { class: 'st-acoes' },
    pasta ? [
      h('button', { type: 'button', class: 'st-mini', 'aria-label': `Novo documento em ${it.titulo}`, title: 'Novo documento', onclick: (e) => { e.stopPropagation(); criarItem(it.id, 'doc'); } }, '＋'),
      h('button', { type: 'button', class: 'st-mini', 'aria-label': `Nova subpasta em ${it.titulo}`, title: 'Nova subpasta', onclick: (e) => { e.stopPropagation(); criarItem(it.id, 'pasta'); } }, '🗀'),
    ] : null,
    h('button', { type: 'button', class: 'st-mini', 'aria-label': `Mais ações para ${it.titulo}`, 'aria-haspopup': 'menu', title: 'Mais ações', onclick: (e) => { e.stopPropagation(); abrirMenu(it, e.currentTarget); } }, '⋯'));
  const linha = h('div', { class: 'st-linha' + (it.id === S.ativa ? ' ativa' : ''), draggable: 'true' },
    pasta ? h('button', { type: 'button', class: 'st-seta', tabindex: '-1', 'aria-hidden': 'true', onclick: () => alternarPasta(it.id) }, aberta ? '▾' : '▸') : h('span', { class: 'st-seta vazio' }),
    h('button', { type: 'button', class: 'st-nome', dataset: { id: it.id }, onclick: () => (pasta ? alternarPasta(it.id) : abrirDoc(it.id)), onkeydown: (e) => tecladoItem(e, it) },
      h('span', { class: 'st-icone', 'aria-hidden': 'true' }, iconeDe(it)), h('span', { class: 'st-rotulo' }, it.titulo || 'Sem título')),
    acoes);
  linha.addEventListener('dragstart', (e) => { S.arrastando = it.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', it.id); linha.classList.add('arrastando'); });
  linha.addEventListener('dragend', () => { S.arrastando = null; linha.classList.remove('arrastando'); limparAlvos(); });
  linha.addEventListener('dragover', (e) => aoArrastarSobre(e, it, linha));
  linha.addEventListener('dragleave', () => linha.classList.remove('alvo-antes', 'alvo-depois', 'alvo-dentro'));
  linha.addEventListener('drop', (e) => aoSoltar(e, it, linha));
  li.append(linha);
  if (pasta && aberta) li.append(h('ul', { role: 'group', class: 'st-arvore' }, filhosVisiveis(it.id).map((f) => no(f, n + 1))));
  return li;
}

function alternarPasta(id) {
  if (S.expandidas.has(id)) S.expandidas.delete(id); else S.expandidas.add(id);
  lsSet(`estudio:arvore:${S.obraId}`, [...S.expandidas]); renderExplorador();
}

function tecladoItem(e, it) {
  const itens = [...E.explorador.querySelectorAll('.st-nome')];
  const i = itens.indexOf(e.currentTarget);
  if (e.key === 'ArrowDown') { e.preventDefault(); (itens[i + 1] || itens[i]).focus(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); (itens[i - 1] || itens[i]).focus(); }
  else if (e.key === 'ArrowRight' && it.tipo === 'pasta' && !S.expandidas.has(it.id)) { e.preventDefault(); alternarPasta(it.id); }
  else if (e.key === 'ArrowLeft' && it.tipo === 'pasta' && S.expandidas.has(it.id)) { e.preventDefault(); alternarPasta(it.id); }
  else if (e.key === 'F2') { e.preventDefault(); renomear(it); }
  else if (e.key === 'Delete') { e.preventDefault(); paraLixeira(it); }
}

// ---- criar / renomear / duplicar / lixeira
async function criarItem(paiId, tipo, docTipoForcado) {
  const pai = paiId ? S.itens.find((i) => i.id === paiId) : null;
  let docTipo = docTipoForcado || 'nota', titulo = tipo === 'pasta' ? 'Nova pasta' : 'Sem título';
  if (tipo === 'doc' && pai && PADROES[pai.doc_tipo]) {
    docTipo = PADROES[pai.doc_tipo][0];
    const n = S.itens.filter((i) => i.pai === paiId && i.tipo === 'doc').length + 1;
    titulo = pai.doc_tipo === 'manuscrito' ? `${PADROES[pai.doc_tipo][1]} ${String(n).padStart(2, '0')}` : `Novo ${TIPOS_DOC[docTipo].toLowerCase()}`;
  }
  try {
    const r = await api.criarDoc(S.obraId, { pai: paiId, tipo, doc_tipo: docTipo, titulo });
    S.itens.push({ id: r.id, pai: paiId, tipo, doc_tipo: tipo === 'pasta' ? 'pasta' : docTipo, titulo, posicao: r.posicao, versao: 1, palavras: 0 });
    if (paiId) S.expandidas.add(paiId);
    renderExplorador();
    if (tipo === 'doc') { await abrirDoc(r.id); E.titulo.focus(); E.titulo.select(); }
  } catch (e) { dialogo({ titulo: 'Não foi possível criar', corpo: h('p', null, e.message) }); }
}

async function renomear(it) {
  const novo = await perguntar('Renomear', 'Título', it.titulo, 'Renomear');
  if (!novo || novo === it.titulo) return;
  const doc = S.docs.get(it.id);
  if (doc) { doc.titulo = novo; if (S.ativa === doc.id) E.titulo.value = novo; saver.marcar(doc); it.titulo = novo; renderAbas(); renderExplorador(); return; }
  try { const r = await api.salvarDoc(S.obraId, it.id, { versao_base: it.versao, titulo: novo }); it.titulo = novo; it.versao = r.versao; renderExplorador(); }
  catch (e) { dialogo({ titulo: 'Não foi possível renomear', corpo: h('p', null, e.status === 409 ? 'Este item mudou em outro lugar. Recarregue a página.' : e.message) }); }
}

async function duplicar(it) {
  if (S.docs.has(it.id) && S.docs.get(it.id).dirty) await saver.salvar(S.docs.get(it.id));
  try { await api.duplicar(S.obraId, it.id); await recarregarArvore(); } catch (e) { dialogo({ titulo: 'Não foi possível duplicar', corpo: h('p', null, e.message) }); }
}

async function paraLixeira(it) {
  const filhos = S.itens.filter((i) => i.pai === it.id).length;
  const msg = it.tipo === 'pasta' ? `A pasta “${it.titulo}” e tudo que está dentro dela (${filhos} item${filhos === 1 ? '' : 's'} no primeiro nível) vão para a lixeira. Dá para restaurar.` : `“${it.titulo}” vai para a lixeira. Dá para restaurar.`;
  if (!(await confirmar('Enviar para a lixeira?', msg, 'Enviar para a lixeira', true))) return;
  const sub = new Set([it.id]); let achou = true;
  while (achou) { achou = false; for (const i of S.itens) if (i.pai && sub.has(i.pai) && !sub.has(i.id)) { sub.add(i.id); achou = true; } }
  for (const id of sub) { const d = S.docs.get(id); if (d && d.dirty) { if (id === S.ativa) guardarAtivo(); await saver.salvar(d); } }
  try { await api.paraLixeira(S.obraId, it.id); } catch (e) { return dialogo({ titulo: 'Não foi possível enviar', corpo: h('p', null, e.message) }); }
  for (const id of sub) { const d = S.docs.get(id); if (d) { saver.esquecer(d); S.docs.delete(id); limparBackup(id); } S.abas = S.abas.filter((a) => a !== id); }
  S.itens = S.itens.filter((i) => !sub.has(i.id));
  if (sub.has(S.ativa)) { S.ativa = null; if (S.abas.length) ativar(S.abas[0]); else mostrarVazio(); }
  lsSet(`estudio:abas:${S.obraId}`, { abas: S.abas, ativa: S.ativa });
  renderAbas(); renderExplorador();
}

async function recarregarArvore() {
  const r = await api.obra(S.obraId);
  S.itens = r.itens; S.tags = r.tags || []; S.obra = r.obra; E.barTitulo.textContent = r.obra.titulo;
  for (const [id, doc] of S.docs) { const it = S.itens.find((i) => i.id === id); if (!it) continue; if (!doc.dirty) it.titulo = doc.titulo; }
  renderExplorador(); renderAbas();
}

// ---- menu de acoes (...)
function abrirMenu(it, ancora) {
  fecharMenu();
  const itemMenu = (rotulo, fn, perigo) => h('button', { type: 'button', role: 'menuitem', class: 'st-menu-item' + (perigo ? ' perigo' : ''), onclick: () => { fecharMenu(); fn(); } }, rotulo);
  const menu = h('div', { class: 'st-menu', role: 'menu', 'aria-label': `Ações de ${it.titulo}` },
    itemMenu('Renomear (F2)', () => renomear(it)),
    it.tipo === 'doc' ? itemMenu('Duplicar', () => duplicar(it)) : null,
    it.tipo === 'pasta' ? itemMenu('Importar manuscrito aqui...', () => importarNaPasta(it)) : null,
    itemMenu('Mover para...', () => moverPara(it)),
    itemMenu('Enviar para a lixeira', () => paraLixeira(it), true));
  document.body.append(menu);
  const r = ancora.getBoundingClientRect();
  menu.style.top = `${Math.min(r.bottom + 4, window.innerHeight - 190)}px`; menu.style.left = `${Math.min(r.left, window.innerWidth - 210)}px`;
  menu.querySelector('button').focus();
  const fora = (e) => { if (!menu.contains(e.target)) fecharMenu(); };
  const tecla = (e) => { if (e.key === 'Escape') { fecharMenu(); ancora.focus(); } };
  setTimeout(() => { document.addEventListener('mousedown', fora); document.addEventListener('keydown', tecla); }, 0);
  menu._limpar = () => { document.removeEventListener('mousedown', fora); document.removeEventListener('keydown', tecla); };
}
function fecharMenu() { for (const m of document.querySelectorAll('.st-menu')) { if (m._limpar) m._limpar(); m.remove(); } }

async function moverPara(it) {
  const sub = new Set([it.id]); let achou = true;
  while (achou) { achou = false; for (const i of S.itens) if (i.pai && sub.has(i.pai) && !sub.has(i.id)) { sub.add(i.id); achou = true; } }
  const pastas = S.itens.filter((i) => i.tipo === 'pasta' && !sub.has(i.id));
  const caminho = (p) => { const partes = []; let c = p; while (c) { partes.unshift(c.titulo); c = S.itens.find((i) => i.id === c.pai); } return partes.join(' / '); };
  const sel = h('select', { class: 'st-campo', 'aria-label': 'Pasta de destino' }, h('option', { value: '' }, '(raiz da obra)'), pastas.map((p) => h('option', { value: p.id, selected: p.id === it.pai }, caminho(p))));
  const v = await dialogo({ titulo: `Mover “${it.titulo}”`, corpo: h('label', { class: 'fld' }, h('span', null, 'Pasta de destino'), sel), botoes: [{ rotulo: 'Cancelar', valor: null }, { rotulo: 'Mover', valor: 'ok', classe: 'btn-primary' }] });
  if (v !== 'ok') return;
  await executarMover(it, sel.value || null, null);
}

async function executarMover(it, paiId, posicao) {
  try {
    const r = await api.mover(S.obraId, it.id, paiId, posicao);
    it.pai = paiId; it.posicao = r.posicao;
    const d = S.docs.get(it.id); if (d) d.pai = paiId;
    if (paiId) S.expandidas.add(paiId);
    renderExplorador();
  } catch (e) { dialogo({ titulo: 'Não foi possível mover', corpo: h('p', null, e.message) }); }
}

// ---- arrastar e soltar
function zona(e, it, linha) {
  const r = linha.getBoundingClientRect(); const y = (e.clientY - r.top) / r.height;
  if (it.tipo === 'pasta') return y < 0.25 ? 'antes' : y > 0.75 ? 'depois' : 'dentro';
  return y < 0.5 ? 'antes' : 'depois';
}
function limparAlvos() { for (const el of E.explorador.querySelectorAll('.alvo-antes,.alvo-depois,.alvo-dentro')) el.classList.remove('alvo-antes', 'alvo-depois', 'alvo-dentro'); }
function ehDescendente(id, ancestral) { let c = S.itens.find((i) => i.id === id); while (c) { if (c.pai === ancestral) return true; c = S.itens.find((i) => i.id === c.pai); } return false; }
function aoArrastarSobre(e, it, linha) {
  if (!S.arrastando || S.arrastando === it.id || ehDescendente(it.id, S.arrastando)) return;
  e.preventDefault(); e.dataTransfer.dropEffect = 'move';
  limparAlvos(); linha.classList.add('alvo-' + zona(e, it, linha));
}
async function aoSoltar(e, alvo, linha) {
  e.preventDefault();
  const id = S.arrastando; const z = zona(e, alvo, linha); limparAlvos();
  const mov = S.itens.find((i) => i.id === id);
  if (!mov || id === alvo.id || ehDescendente(alvo.id, id)) return;
  if (z === 'dentro') { await executarMover(mov, alvo.id, null); return; }
  const pai = alvo.pai || null;
  const irmaos = filhosDe(pai).filter((i) => i.id !== id);
  const k = irmaos.findIndex((i) => i.id === alvo.id);
  const anterior = z === 'antes' ? irmaos[k - 1] : irmaos[k], seguinte = z === 'antes' ? irmaos[k] : irmaos[k + 1];
  const pos = anterior && seguinte ? (anterior.posicao + seguinte.posicao) / 2 : anterior ? anterior.posicao + 1 : seguinte ? seguinte.posicao - 1 : 1;
  await executarMover(mov, pai, pos);
}

// ============================================================== contexto
let ultimasStats = { palavras: 0, caracteres: 0 };
function atualizarContextoStats(s) { ultimasStats = s; const el = E.contexto && E.contexto.querySelector('[data-stat="palavras"]'); if (el) el.textContent = milhar(s.palavras); }

function renderContexto() {
  if (!S || !E.contexto) return;
  const d = docAtivo();
  const linha = (rotulo, valor, stat) => h('div', { class: 'st-prop' }, h('dt', null, rotulo), h('dd', { dataset: stat ? { stat } : null }, valor));
  const total = S.itens.filter((i) => i.tipo === 'doc' && ['capitulo', 'cena'].includes(i.doc_tipo)).reduce((s, i) => s + (i.palavras || 0), 0);
  E.contexto.replaceChildren(
    h('h2', null, 'Contexto'),
    d ? h('section', { 'aria-labelledby': 'ctx-prop' }, h('h3', { id: 'ctx-prop' }, 'Propriedades'),
      h('dl', { class: 'st-props' },
        linha('Tipo', TIPOS_DOC[d.tipo] || d.tipo), linha('Palavras', milhar(ultimasStats.palavras), 'palavras'),
        linha('Versão salva', `v${d.versao}`), d.atualizadoEm ? linha('Última gravação', dataHora(d.atualizadoEm)) : null))
      : h('p', { class: 'hint' }, 'Abra um documento para ver as propriedades.'),
    d ? secaoTags(d) : null,
    d ? secaoConexoes(d) : null,
    h('section', { 'aria-labelledby': 'ctx-obra' }, h('h3', { id: 'ctx-obra' }, 'A obra'),
      h('dl', { class: 'st-props' },
        linha('Manuscrito', `${milhar(total)} palavras`),
        S.obra.meta && S.obra.meta.meta_palavras ? linha('Meta', `${milhar(S.obra.meta.meta_palavras)} (${Math.min(100, Math.round(total / S.obra.meta.meta_palavras * 100))}%)`) : null,
        linha('Status', STATUS_OBRA[S.obra.status] || S.obra.status))));
}

// ============================================================== obra: informacoes e lixeira
async function dialogoObra() {
  const m = S.obra.meta || {};
  const titulo = h('input', { class: 'st-campo', type: 'text', maxlength: '200', value: S.obra.titulo });
  const genero = h('input', { class: 'st-campo', type: 'text', maxlength: '80', value: m.genero || '' });
  const sinopse = h('textarea', { class: 'st-campo', rows: '4', maxlength: '3000' }, m.sinopse || '');
  const meta = h('input', { class: 'st-campo', type: 'number', min: '0', max: '5000000', step: '1000', value: m.meta_palavras || '' });
  const publicada = ['agendado', 'publicado', 'atualizado'].includes(S.obra.status);
  const status = h('select', { class: 'st-campo', disabled: publicada || null }, ['rascunho', 'em_revisao', 'arquivado'].map((s) => h('option', { value: s, selected: s === S.obra.status }, STATUS_OBRA[s])), publicada ? h('option', { value: S.obra.status, selected: true }, STATUS_OBRA[S.obra.status]) : null);
  const f = (rot, el) => h('label', { class: 'fld' }, h('span', null, rot), el);
  const v = await dialogo({ titulo: 'Informações da obra', corpo: [f('Título', titulo), f('Gênero', genero), f('Sinopse', sinopse), f('Meta de palavras (opcional)', meta), f('Status', status)], botoes: [{ rotulo: 'Cancelar', valor: null }, { rotulo: 'Salvar', valor: 'ok', classe: 'btn-primary' }], largo: true });
  if (v !== 'ok') return;
  const dados = { titulo: titulo.value, meta: { genero: genero.value, sinopse: sinopse.value, meta_palavras: meta.value || 0 } };
  if (!publicada) dados.status = status.value;
  try { await api.editarObra(S.obraId, dados); const r = await api.obra(S.obraId); S.obra = r.obra; E.barTitulo.textContent = r.obra.titulo; document.title = `${r.obra.titulo} | Estúdio`; renderExplorador(); renderContexto(); }
  catch (e) { dialogo({ titulo: 'Não foi possível salvar', corpo: h('p', null, e.message) }); }
}

async function dialogoLixeira() {
  let itens;
  try { itens = (await api.lixeira(S.obraId)).itens; } catch (e) { return dialogo({ titulo: 'Lixeira', corpo: h('p', null, e.message) }); }
  const lista = h('ul', { class: 'st-lixeira' });
  const desenhar = () => {
    lista.replaceChildren(...(itens.length ? itens.map((i) => h('li', null,
      h('span', null, `${i.kind === 'pasta' ? '🗀' : '≡'} ${i.title}`, h('small', null, ` · enviado ${relativo(i.deleted_at)}`)),
      h('span', { class: 'st-lixeira-acoes' },
        h('button', { type: 'button', class: 'btn btn-ghost', onclick: async () => { await api.restaurar(S.obraId, i.id); itens = itens.filter((x) => x.id !== i.id); await recarregarArvore(); desenhar(); } }, 'Restaurar'),
        h('button', { type: 'button', class: 'btn btn-ghost', onclick: async () => { if (!(await confirmar('Apagar definitivamente?', `“${i.title}” será apagado para sempre. Isso não pode ser desfeito.`, 'Apagar para sempre', true))) return; await api.apagarDefinitivo(S.obraId, i.id); itens = itens.filter((x) => x.id !== i.id); desenhar(); } }, 'Apagar')))) : [h('li', { class: 'muted-note' }, 'A lixeira está vazia.')]));
  };
  desenhar();
  await dialogo({ titulo: 'Lixeira', corpo: lista, largo: true });
}

// ============================================================== foco, paineis, atalhos
function alternarFoco() { document.body.classList.toggle('st-foco'); if (document.body.classList.contains('st-foco')) { const d = docAtivo(); if (d && d.modo === 'visual') ed.focus(); } }

function alternarPainel(qual) {
  E.main.dataset[qual] = E.main.dataset[qual] === 'true' ? 'false' : 'true';
  if (window.innerWidth >= 900) lsSet('estudio:paineis', { exp: E.main.dataset.exp === 'true', ctx: E.main.dataset.ctx === 'true' });
  if (window.innerWidth < 900) { const outro = qual === 'exp' ? 'ctx' : 'exp'; E.main.dataset[outro] = 'false'; }
  sincronizarPaineis();
}
function sincronizarPaineis() {
  const e = document.getElementById('st-tg-exp'), c = document.getElementById('st-tg-ctx');
  if (e) e.setAttribute('aria-pressed', E.main.dataset.exp);
  if (c) c.setAttribute('aria-pressed', E.main.dataset.ctx);
}

function prepararRedimensionar() {
  for (const r of E.main.querySelectorAll('.st-resizer')) {
    const lado = r.dataset.lado;
    const ajustar = (x) => {
      const b = E.main.getBoundingClientRect();
      const px = lado === 'esq' ? x - b.left : b.right - x;
      const v = Math.max(180, Math.min(520, Math.round(px)));
      E.main.style.setProperty(lado === 'esq' ? '--st-esq' : '--st-dir', v + 'px');
      return v;
    };
    const salvar = () => lsSet('estudio:larguras', { esq: parseInt(getComputedStyle(E.main).getPropertyValue('--st-esq'), 10), dir: parseInt(getComputedStyle(E.main).getPropertyValue('--st-dir'), 10) });
    r.addEventListener('pointerdown', (e) => {
      e.preventDefault(); r.setPointerCapture(e.pointerId); r.classList.add('arrastando');
      const mover = (ev) => ajustar(ev.clientX);
      const soltar = () => { r.classList.remove('arrastando'); r.removeEventListener('pointermove', mover); r.removeEventListener('pointerup', soltar); salvar(); };
      r.addEventListener('pointermove', mover); r.addEventListener('pointerup', soltar);
    });
    r.addEventListener('keydown', (e) => { // acessivel por teclado
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const atual = parseInt(getComputedStyle(E.main).getPropertyValue(lado === 'esq' ? '--st-esq' : '--st-dir'), 10) || 270;
      const delta = (e.key === 'ArrowRight' ? 1 : -1) * (lado === 'esq' ? 1 : -1) * 20;
      E.main.style.setProperty(lado === 'esq' ? '--st-esq' : '--st-dir', Math.max(180, Math.min(520, atual + delta)) + 'px'); salvar();
    });
  }
}

function atalhos(e) {
  if (!S) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.shiftKey && e.key.toLowerCase() === 'f') { e.preventDefault(); alternarFoco(); }
  else if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') { e.preventDefault(); if (!document.querySelector('dialog[open]')) abrirBuscaObra(); }
  else if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'p') { e.preventDefault(); if (!document.querySelector('dialog[open]')) abrirPaleta(ctxPaleta(), comandos()); }
  else if (e.key === 'Escape' && document.body.classList.contains('st-foco') && !document.querySelector('dialog[open]')) alternarFoco();
}

// ============================================================== links internos [[...]]
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const docPorTitulo = (t) => S.itens.filter((i) => i.tipo === 'doc' && norm(i.titulo) === norm(t)).sort((a, b) => (b.atualizado_em || 0) - (a.atualizado_em || 0))[0] || null;

let decoracaoTimer = null;
function agendarDecoracao() { clearTimeout(decoracaoTimer); decoracaoTimer = setTimeout(() => { if (ed) ed.atualizarLinks(); }, 120); }

// ---- popup de autocompletar ao digitar [[
let pop = null, popItens = [], popSel = 0, popQ = null;
function fecharPop() { if (pop) { pop.remove(); pop = null; } popItens = []; popQ = null; }
function aoConsultaLink(q) {
  if (!q || !S) return fecharPop();
  popQ = q;
  const nq = norm(q.consulta);
  const docs = S.itens.filter((i) => i.tipo === 'doc' && i.id !== S.ativa && norm(i.titulo).includes(nq))
    .sort((a, b) => (norm(b.titulo).startsWith(nq) ? 1 : 0) - (norm(a.titulo).startsWith(nq) ? 1 : 0) || a.titulo.localeCompare(b.titulo, 'pt-BR')).slice(0, 8);
  popItens = docs.map((d) => ({ titulo: d.titulo, tipo: d.doc_tipo }));
  if (q.consulta.trim() && !S.itens.some((i) => i.tipo === 'doc' && norm(i.titulo) === nq)) popItens.push({ titulo: q.consulta.trim(), criar: true });
  if (!popItens.length) { if (pop) { pop.remove(); pop = null; } return; }
  popSel = Math.min(popSel, popItens.length - 1);
  desenharPop();
}
function desenharPop() {
  if (!pop) { pop = h('div', { class: 'st-link-pop', role: 'listbox', 'aria-label': 'Documentos para linkar' }); document.body.append(pop); }
  pop.replaceChildren(...popItens.map((it, i) => h('div', { role: 'option', id: 'st-lk-' + i, class: 'st-link-op' + (i === popSel ? ' sel' : ''), 'aria-selected': i === popSel ? 'true' : 'false',
    onmousedown: (e) => { e.preventDefault(); escolherPopLink(i); } },
    it.criar ? [h('span', null, 'Criar “' + it.titulo + '”'), h('small', null, 'novo documento')] : [h('span', null, it.titulo), h('small', null, TIPOS_DOC[it.tipo] || '')])));
  const c = popQ.coords;
  pop.style.left = Math.max(8, Math.min(c.left, window.innerWidth - 300)) + 'px';
  pop.style.top = Math.min(c.bottom + 6, window.innerHeight - pop.offsetHeight - 8) + 'px';
}
function teclaPopLink(tecla) {
  if (!pop) return false;
  if (tecla === 'ArrowDown') { popSel = (popSel + 1) % popItens.length; desenharPop(); }
  else if (tecla === 'ArrowUp') { popSel = (popSel - 1 + popItens.length) % popItens.length; desenharPop(); }
  else if (tecla === 'Escape') { fecharPop(); ed.cancelarLink(); }
  else escolherPopLink(popSel); // Enter ou Tab
  return true;
}
async function escolherPopLink(i) {
  const it = popItens[i]; if (!it) return;
  ed.confirmarLink(it.titulo); fecharPop();
  if (it.criar) await criarNotaParaLink(it.titulo); // o link ja esta no texto; o destino nasce em seguida
}

async function criarNotaParaLink(titulo) {
  const pasta = pastaDe('ideias');
  try {
    const r = await api.criarDoc(S.obraId, { pai: pasta ? pasta.id : null, doc_tipo: 'nota', titulo, corpo: '' });
    S.itens.push({ id: r.id, pai: pasta ? pasta.id : null, tipo: 'doc', doc_tipo: 'nota', titulo, posicao: r.posicao, versao: 1, palavras: 0, tags: [] });
    if (pasta) S.expandidas.add(pasta.id);
    renderExplorador(); agendarConexoes(0); avisar('Criamos o documento “' + titulo + '”' + (pasta ? ' em Ideias' : '') + '.');
    return r.id;
  } catch (e) { dialogo({ titulo: 'Não foi possível criar o documento', corpo: h('p', null, e.message) }); return null; }
}

async function abrirPorTitulo(titulo) {
  const d = docPorTitulo(titulo);
  if (d) return abrirDoc(d.id);
  if (await confirmar('Esse documento ainda não existe', 'Criar “' + titulo + '” agora e abrir?', 'Criar e abrir')) {
    const id = await criarNotaParaLink(titulo);
    if (id) abrirDoc(id);
  }
}

// ---- painel de conexoes (links desta nota e backlinks)
let conexoesTimer = null;
function agendarConexoes(ms) { clearTimeout(conexoesTimer); conexoesTimer = setTimeout(carregarConexoes, ms); }
async function carregarConexoes() {
  const d = docAtivo(); if (!S || !d) return;
  const alvo = d.id; S.conexReq = (S.conexReq || 0) + 1; const n = S.conexReq;
  try {
    const r = await api.links(S.obraId, alvo);
    if (!S || n !== S.conexReq || S.ativa !== alvo) return;
    S.conex = { docId: alvo, saem: r.saem, entram: r.entram };
  } catch { return; }
  renderContexto();
}
function secaoConexoes(d) {
  const L = S.conex && S.conex.docId === d.id ? S.conex : null;
  const abrirBtn = (id, titulo, tipo) => h('button', { type: 'button', class: 'st-lk', onclick: () => abrirDoc(id) }, h('span', null, titulo), h('small', null, TIPOS_DOC[tipo] || ''));
  return h('section', { 'aria-labelledby': 'ctx-conex' }, h('h3', { id: 'ctx-conex' }, 'Conexões'),
    h('h4', { class: 'st-sub' }, 'Esta nota é mencionada em'),
    !L ? h('p', { class: 'hint' }, 'Carregando...')
      : L.entram.length ? h('ul', { class: 'st-lista-links' }, L.entram.map((x) => h('li', null, abrirBtn(x.id, x.titulo, x.doc_tipo))))
        : h('p', { class: 'hint' }, 'Nenhuma menção ainda.'),
    h('h4', { class: 'st-sub' }, 'Links desta nota'),
    !L ? null
      : L.saem.length ? h('ul', { class: 'st-lista-links' }, L.saem.map((x) => h('li', null,
        x.destino ? abrirBtn(x.destino.id, x.destino.titulo, x.destino.doc_tipo)
          : h('span', { class: 'st-lk quebrado' }, h('span', null, x.titulo), h('small', null, 'não existe'),
            h('button', { type: 'button', class: 'st-mini', title: 'Criar este documento', 'aria-label': 'Criar o documento ' + x.titulo, onclick: async () => { await criarNotaParaLink(x.titulo); } }, 'criar')))))
        : h('p', { class: 'hint' }, 'Escreva [[ para linkar outro documento da obra.'));
}

// ============================================================== tags, busca e paleta
const HASHTAG_RE = /(?:^|[\s(>])\\?#([\p{L}][\p{L}\p{N}_-]{1,29})(?![\p{L}\p{N}_-])/gu;
const hashtagsDe = (md) => [...new Set([...String(md || '').matchAll(HASHTAG_RE)].map((m) => m[1].toLowerCase()))].sort();

function secaoTags(d) {
  const it = S.itens.find((i) => i.id === d.id); if (!it) return null;
  const doTexto = new Set(d.tagsTexto || []);
  const campo = h('input', { class: 'st-campo st-tag-campo', type: 'text', maxlength: '31', placeholder: 'Nova tag e Enter', 'aria-label': 'Adicionar tag', list: 'st-tags-existentes',
    onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); const v = campo.value; campo.value = ''; adicionarTag(d, v); } } });
  return h('section', { 'aria-labelledby': 'ctx-tags' }, h('h3', { id: 'ctx-tags' }, 'Tags'),
    h('div', { class: 'st-chips' }, (it.tags || []).length
      ? it.tags.map((t) => h('span', { class: 'st-chip' },
        h('button', { type: 'button', class: 'st-chip-nome', title: 'Filtrar o explorador por esta tag', onclick: () => { S.filtroTag = t; renderExplorador(); } }, '#' + t),
        doTexto.has(t) ? h('span', { class: 'st-chip-texto', title: 'Vem do texto: apague a #hashtag no texto para tirar', 'aria-label': 'tag vinda do texto' }, '✎')
          : h('button', { type: 'button', class: 'st-chip-x', 'aria-label': 'Remover a tag ' + t, onclick: () => removerTag(d, t) }, '×')))
      : h('p', { class: 'hint' }, 'Nenhuma tag. Escreva #resolver no texto ou adicione abaixo.')),
    campo, h('datalist', { id: 'st-tags-existentes' }, S.tags.map((t) => h('option', { value: t.tag }))));
}
const manuaisDe = (d) => { const it = S.itens.find((i) => i.id === d.id); const tx = new Set(d.tagsTexto || []); return ((it && it.tags) || []).filter((t) => !tx.has(t)); };
async function salvarTags(d, manuais) {
  try { await api.tags(S.obraId, d.id, manuais); await recarregarTags(); }
  catch (e) { dialogo({ titulo: 'Não foi possível salvar as tags', corpo: h('p', null, e.message) }); }
}
function adicionarTag(d, valor) { const t = String(valor).trim().replace(/^#/, '').toLowerCase(); if (t) salvarTags(d, [...new Set([...manuaisDe(d), t])]); }
function removerTag(d, t) { salvarTags(d, manuaisDe(d).filter((x) => x !== t)); }
async function recarregarTags() {
  const r = await api.obra(S.obraId);
  S.tags = r.tags || [];
  for (const n of r.itens) { const it = S.itens.find((i) => i.id === n.id); if (it) it.tags = n.tags; }
  if (S.filtroTag && !S.tags.some((t) => t.tag === S.filtroTag)) S.filtroTag = null;
  renderExplorador(); renderContexto();
}

const ctxPaleta = () => ({ api, obraId: () => S.obraId, itens: () => S.itens, tags: () => S.tags, abrirDoc: (id) => abrirDoc(id) });
function abrirBuscaObra() {
  const sel = ed && docAtivo() && docAtivo().modo === 'visual' ? ed.selectedText().trim() : '';
  abrirBusca(ctxPaleta(), sel.length >= 2 && sel.length <= 60 ? sel : '');
}
const pastaDe = (tipo) => S.itens.find((i) => i.tipo === 'pasta' && i.doc_tipo === tipo);
function comandos() {
  const c = (rotulo, dica, acao) => ({ rotulo, dica, acao });
  const novo = (rotulo, pasta) => c(rotulo, 'Criar', () => { const p = pastaDe(pasta); criarItem(p ? p.id : null, 'doc', 'nota'); });
  return [
    novo('Criar capítulo', 'manuscrito'), novo('Criar personagem', 'personagens'), novo('Criar nota', 'ideias'),
    c('Criar pasta', 'Criar', () => criarItem(null, 'pasta')),
    c('Pesquisar na obra', 'Ctrl+K', abrirBuscaObra),
    c('Alternar modo foco', 'Ctrl+Shift+F', alternarFoco),
    c('Alternar visual e Markdown', 'Editor', alternarModo),
    c('Importar manuscrito', 'Arquivo', () => importarNaPasta(pastaDe('manuscrito') || null)), c('Exportar', 'Arquivo', exportarObra),
    c('Informações da obra', 'Obra', dialogoObra), c('Abrir a lixeira', 'Obra', dialogoLixeira),
    c('Mostrar ou esconder o explorador', 'Painéis', () => alternarPainel('exp')), c('Mostrar ou esconder o contexto', 'Painéis', () => alternarPainel('ctx')),
    c('Voltar à lista de obras', 'Estúdio', () => { location.hash = '#/'; }),
  ];
}

// ============================================================== importar e exportar
async function importarNaPasta(pasta) {
  const docTipo = !pasta || pasta.doc_tipo === 'manuscrito' ? 'capitulo' : 'nota';
  const r = await importarManuscrito({ obraId: S.obraId, pastaId: pasta ? pasta.id : null, docTipo });
  if (!r || !S) return;
  if (pasta) S.expandidas.add(pasta.id);
  await recarregarArvore();
  if (r.primeiro) abrirDoc(r.primeiro);
}
function exportarObra() {
  if (docAtivo()) guardarAtivo();
  abrirExportacao({ obra: S.obra, obraId: S.obraId, itens: S.itens, antes: () => saver.todos() });
}

// ============================================================== avisos
function avisar(texto) {
  const el = h('div', { class: 'st-aviso', role: 'status' }, texto);
  document.body.append(el); setTimeout(() => el.remove(), 5000);
}

window.addEventListener('hashchange', () => {
  const r = rota();
  if (S && r.obra === S.obraId) { if (r.doc && r.doc !== S.ativa && S.itens.some((i) => i.id === r.doc)) abrirDoc(r.doc); return; }
  iniciar();
});
iniciar();
