// Utilidades de interface do Estudio: criacao segura de DOM (sem innerHTML), dialogos e formatacao.

export const h = (tag, attrs, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
};

// Dialogo modal acessivel (<dialog>: foco preso e Esc fechando). Retorna o `valor` do botao clicado ou null.
export function dialogo({ titulo, corpo, botoes = [{ rotulo: 'Fechar', valor: null }], largo = false }) {
  return new Promise((resolve) => {
    const dlg = h('dialog', { class: 'st-dialogo' + (largo ? ' largo' : ''), 'aria-labelledby': 'st-dlg-t' });
    let resultado = null;
    const rodape = h('div', { class: 'st-dialogo-rodape' }, botoes.map((b) =>
      h('button', { type: 'button', class: 'btn ' + (b.classe || 'btn-ghost'), onclick: () => { resultado = b.valor; dlg.close(); } }, b.rotulo)));
    dlg.append(h('h2', { id: 'st-dlg-t' }, titulo), h('div', { class: 'st-dialogo-corpo' }, corpo), rodape);
    dlg.addEventListener('close', () => { dlg.remove(); resolve(resultado); });
    document.body.append(dlg);
    dlg.showModal();
  });
}

export async function confirmar(titulo, texto, rotulo = 'Confirmar', perigo = false) {
  const v = await dialogo({
    titulo, corpo: h('p', null, texto),
    botoes: [{ rotulo: 'Cancelar', valor: false }, { rotulo, valor: true, classe: perigo ? 'btn-perigo' : 'btn-primary' }],
  });
  return v === true;
}

// pergunta um texto curto
export function perguntar(titulo, rotuloCampo, valorInicial = '', rotuloOk = 'Salvar') {
  const campo = h('input', { type: 'text', value: valorInicial, maxlength: '200', 'aria-label': rotuloCampo, class: 'st-campo' });
  const p = dialogo({
    titulo, corpo: h('label', { class: 'fld' }, h('span', null, rotuloCampo), campo),
    botoes: [{ rotulo: 'Cancelar', valor: null }, { rotulo: rotuloOk, valor: 'ok', classe: 'btn-primary' }],
  });
  campo.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); campo.closest('dialog').querySelector('.btn-primary').click(); } });
  setTimeout(() => { campo.focus(); campo.select(); }, 30);
  return p.then((v) => (v === 'ok' ? campo.value.trim() : null));
}

const MS = { min: 60, h: 3600, d: 86400 };
export function relativo(seg) {
  const d = Math.floor(Date.now() / 1000) - seg;
  if (d < 45) return 'agora há pouco';
  if (d < MS.h) return `há ${Math.round(d / MS.min)} min`;
  if (d < MS.d) return `há ${Math.round(d / MS.h)} h`;
  if (d < 7 * MS.d) return `há ${Math.round(d / MS.d)} d`;
  return new Date(seg * 1000).toLocaleDateString('pt-BR');
}
export const dataHora = (seg) => new Date(seg * 1000).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
export const milhar = (n) => Number(n || 0).toLocaleString('pt-BR');

export const TIPOS_OBRA = { texto: 'Texto', hq: 'HQ / Quadrinho', hibrida: 'Obra híbrida' };
export const STATUS_OBRA = {
  rascunho: 'Rascunho', em_revisao: 'Em revisão', agendado: 'Agendada', publicado: 'Publicada', atualizado: 'Publicada (atualizada)', arquivado: 'Arquivada',
};
export const TIPOS_DOC = {
  capitulo: 'Capítulo', cena: 'Cena', personagem: 'Personagem', lugar: 'Lugar', objeto: 'Objeto', evento: 'Evento', pesquisa: 'Pesquisa', nota: 'Nota',
};
