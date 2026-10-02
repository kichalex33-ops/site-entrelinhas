// Exportar: manuscrito (DOCX, Markdown, TXT) ou projeto completo (Markdown). Notas privadas nunca entram no manuscrito.
import { h, milhar, TIPOS_DOC } from './ui.js';
import { api } from './api.js';

let modulo = null;
const carregar = () => modulo || (modulo = import('../vendor/estudio-exportar.js'));

const filhos = (itens, pai) => itens.filter((i) => (i.pai || null) === (pai || null)).sort((a, b) => a.posicao - b.posicao);
const percorrer = (itens, pai, fn, caminho = []) => {
  for (const it of filhos(itens, pai)) {
    if (it.tipo === 'pasta') percorrer(itens, it.id, fn, [...caminho, it.titulo]);
    else fn(it, caminho);
  }
};

// documentos do manuscrito, na ordem da arvore (inclui subpastas)
export function docsDoManuscrito(itens) {
  const raiz = itens.filter((i) => i.tipo === 'pasta' && i.doc_tipo === 'manuscrito');
  const out = [];
  for (const r of raiz) percorrer(itens, r.id, (d) => out.push(d));
  return out;
}
export function docsDoProjeto(itens) { const out = []; percorrer(itens, null, (d, caminho) => out.push({ ...d, caminho })); return out; }

// opts: { obra: { titulo }, itens, antes: async () => void (salva o que esta pendente) }
export function abrirExportacao({ obra, obraId, itens, antes, autorPadrao = '' }) {
  const manuscrito = docsDoManuscrito(itens), projeto = docsDoProjeto(itens);
  const palavrasMs = manuscrito.reduce((s, d) => s + (d.palavras || 0), 0);
  const dlg = h('dialog', { class: 'st-dialogo largo', 'aria-labelledby': 'st-exp-t' });
  const escopo = h('select', { class: 'st-campo', 'aria-label': 'O que exportar' },
    h('option', { value: 'ms' }, `Manuscrito: ${manuscrito.length} documento(s), ${milhar(palavrasMs)} palavras`),
    h('option', { value: 'tudo' }, `Projeto completo: ${projeto.length} documento(s), com notas, fichas e pesquisa`));
  const formato = h('select', { class: 'st-campo', 'aria-label': 'Formato' },
    h('option', { value: 'docx' }, 'Word (.docx)'), h('option', { value: 'md' }, 'Markdown (.md)'), h('option', { value: 'txt' }, 'Texto simples (.txt)'));
  const autor = h('input', { class: 'st-campo', type: 'text', maxlength: '120', value: autorPadrao, placeholder: 'opcional' });
  const aviso = h('p', { class: 'hint', role: 'status' });
  const estado = h('p', { role: 'status', class: 'st-exp-estado' });
  const ok = h('button', { type: 'button', class: 'btn btn-primary', onclick: exportar }, 'Exportar');
  const cancelar = h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => dlg.close() }, 'Fechar');
  const f = (rot, el) => h('label', { class: 'fld' }, h('span', null, rot), el);
  let ocupado = false;

  const atualizarAviso = () => {
    const completo = escopo.value === 'tudo';
    if (completo) { formato.value = 'md'; formato.disabled = true; } else formato.disabled = false;
    autor.disabled = completo;
    aviso.textContent = completo
      ? 'O projeto completo é uma cópia para você guardar: inclui [[links]], #tags, personagens, mundo e pesquisa, em um único arquivo Markdown.'
      : 'O manuscrito leva só os capítulos e cenas, na ordem da pasta Manuscrito. Notas, fichas, pesquisa, [[links]] e #tags privados ficam de fora.';
  };
  escopo.addEventListener('change', atualizarAviso); atualizarAviso();

  async function exportar() {
    const lista = escopo.value === 'tudo' ? projeto : manuscrito;
    if (!lista.length) { estado.textContent = 'Não há documentos para exportar nesta seleção.'; return; }
    ocupado = true; ok.disabled = true; cancelar.disabled = true; estado.textContent = 'Preparando...';
    try {
      if (antes) await antes(); // salva o que ainda esta pendente
      const m = await carregar();
      const docs = [];
      for (let i = 0; i < lista.length; i++) {
        estado.textContent = `Lendo documento ${i + 1} de ${lista.length}...`;
        const d = await api.doc(obraId, lista[i].id);
        docs.push({ titulo: d.titulo, corpo: d.corpo, tipo: d.doc_tipo, caminho: lista[i].caminho || [] });
      }
      estado.textContent = 'Gerando o arquivo...';
      const meta = { titulo: obra.titulo, autor: autor.value.trim() };
      const base = m.nomeArquivoSeguro(obra.titulo);
      let blob, nome;
      if (escopo.value === 'tudo') {
        const partes = ['# ' + obra.titulo];
        let ultimaPasta = null;
        for (const d of docs) {
          const pasta = d.caminho.join(' / ');
          if (pasta !== ultimaPasta) { ultimaPasta = pasta; if (pasta) partes.push('## ' + pasta); }
          partes.push('### ' + d.titulo + (TIPOS_DOC[d.tipo] ? ` (${TIPOS_DOC[d.tipo]})` : '') + '\n\n' + d.corpo.trim());
        }
        blob = new Blob([partes.join('\n\n') + '\n'], { type: 'text/markdown;charset=utf-8' }); nome = `${base}-projeto-completo.md`;
      } else if (formato.value === 'docx') { blob = await m.gerarDocx(docs, meta); nome = `${base}.docx`; }
      else if (formato.value === 'md') { blob = new Blob([m.montarMarkdown(docs, meta)], { type: 'text/markdown;charset=utf-8' }); nome = `${base}.md`; }
      else { blob = new Blob([m.montarTxt(docs, meta)], { type: 'text/plain;charset=utf-8' }); nome = `${base}.txt`; }
      const url = URL.createObjectURL(blob);
      const a = h('a', { href: url, download: nome }); document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      estado.textContent = `Pronto: ${nome} (${Math.max(1, Math.round(blob.size / 1024))} KB).`;
    } catch (e) { estado.textContent = 'Não foi possível exportar: ' + (e.message || 'erro desconhecido'); }
    ocupado = false; ok.disabled = false; cancelar.disabled = false;
  }

  dlg.addEventListener('cancel', (e) => { if (ocupado) e.preventDefault(); });
  dlg.addEventListener('close', () => dlg.remove());
  dlg.append(h('h2', { id: 'st-exp-t' }, 'Exportar'),
    h('div', { class: 'st-dialogo-corpo' }, f('O que exportar', escopo), f('Formato', formato), f('Nome do autor na folha de rosto', autor), aviso, estado),
    h('div', { class: 'st-dialogo-rodape' }, cancelar, ok));
  document.body.append(dlg); dlg.showModal();
}
