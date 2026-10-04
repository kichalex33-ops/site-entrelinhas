// Publicar: escolhe os capitulos, revisa o que o leitor vai ver, aceita a declaracao e publica (agora ou agendado).
// SALVAR nao e PUBLICAR: o servidor tira uma copia do que foi escolhido; editar depois nao muda o que esta no ar.
import { h, dialogo, confirmar, dataHora, milhar, TIPOS_DOC, STATUS_OBRA } from './ui.js';
import { api } from './api.js';
import { docsDoManuscrito, docsDoProjeto } from './exportar-ui.js';

let leitura = null;
const carregarLeitura = () => leitura || (leitura = import('../vendor/estudio-leitura.js'));

const urlLeitura = (autor, slug) => `ler.html?a=${encodeURIComponent(autor)}&o=${encodeURIComponent(slug)}`;
const PROSA = ['capitulo', 'cena'];

// mesma reducao do perfil (conta.js): JPEG de ate ~550 KB
async function reduzir(file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('Envie uma imagem JPEG, PNG ou WebP.');
  const bmp = await createImageBitmap(file);
  let max = 1000;
  for (let i = 0; i < 6; i++) {
    const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.85));
    if (blob && blob.size <= 550 * 1024) return blob;
    max = Math.round(max * 0.8);
  }
  throw new Error('Não foi possível reduzir a imagem. Tente uma menor.');
}

// datetime-local <-> segundos (hora local do navegador)
const paraCampoData = (seg) => { const d = new Date(seg * 1000); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };

// opts: { obraId, obra, itens, antes: async () => void (salva o que esta pendente), aoMudar: (status) => void }
export async function abrirPublicacao({ obraId, obra, itens, antes, aoMudar }) {
  let P;
  try { P = await api.publicacao(obraId); } catch (e) { return dialogo({ titulo: 'Publicação', corpo: h('p', null, e.message) }); }

  const dlg = h('dialog', { class: 'st-dialogo largo st-pub', 'aria-labelledby': 'st-pub-t' });
  const f = (rot, el, dica) => h('label', { class: 'fld' }, h('span', null, rot), el, dica ? h('small', { class: 'hint' }, dica) : null);
  const estado = h('p', { role: 'status', class: 'st-exp-estado' });

  // ---- situacao atual
  const situacao = P.no_ar
    ? h('p', { class: 'st-pub-sit no-ar' }, `No ar desde ${dataHora(P.publicada_em)} · versão ${P.versao} · ${P.capitulos.length} capítulo(s). `, h('a', { href: urlLeitura(P.autor, P.slug), target: '_blank', rel: 'noopener' }, 'Ver como o leitor vê'))
    : P.agendada_para
      ? h('p', { class: 'st-pub-sit' }, `Agendada para ${dataHora(P.agendada_para)} · ${P.capitulos.length} capítulo(s).`)
      : h('p', { class: 'st-pub-sit' }, 'Esta obra ainda não está publicada. Nada do Estúdio aparece para os leitores até você publicar.');

  // ---- informacoes publicas
  const titulo = h('input', { class: 'st-campo', type: 'text', maxlength: '200', value: P.meta.titulo || obra.titulo });
  const genero = h('input', { class: 'st-campo', type: 'text', maxlength: '80', value: P.meta.genero || '' });
  const sinopse = h('textarea', { class: 'st-campo', rows: '4', maxlength: '3000' }, P.meta.sinopse || '');
  const creditos = h('input', { class: 'st-campo', type: 'text', maxlength: '500', value: P.meta.creditos || '', placeholder: 'opcional: revisão, capa, ilustrações...' });
  // classificacao indicativa: obrigatoria para publicar
  const faixaCaixas = window.EL.FAIXAS.map(([v, rot]) => h('input', { type: 'radio', name: 'st-pub-faixa', value: v, checked: P.meta.faixa === v || null, 'aria-label': rot }));
  const faixaEscolhida = () => (faixaCaixas.find((x) => x.checked) || {}).value || '';
  const faixaCampo = h('div', { class: 'faixa-op', role: 'radiogroup', 'aria-label': 'Classificação indicativa' },
    faixaCaixas.map((cx, i) => h('label', { title: window.EL.FAIXAS[i][1] }, cx, h('span', { class: `faixa faixa-${cx.value}` }, cx.value), i === 0 ? ' Livre' : ` ${cx.value} anos`)));

  // ---- capa
  let capa = P.meta.capa || '';
  const capaImg = h('img', { class: 'st-pub-capa', alt: 'Capa da obra' });
  const capaArquivo = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', class: 'st-campo' });
  const capaTirar = h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => { capa = ''; desenharCapa(); } }, 'Tirar a capa');
  const desenharCapa = () => { capaImg.hidden = !capa; capaTirar.hidden = !capa; if (capa) capaImg.src = window.EL.imgUrl(capa); };
  capaArquivo.addEventListener('change', async () => {
    const arq = capaArquivo.files[0]; if (!arq) return;
    try {
      const rec = await window.EL.recortar(arq, { titulo: 'Ajustar a capa' });
      capaArquivo.value = ''; if (!rec) return;
      estado.textContent = 'Enviando a capa...';
      capa = (await api.enviarImagem(await reduzir(rec))).id; estado.textContent = 'Capa enviada.'; desenharCapa();
    } catch (e) { estado.textContent = e.message; }
    capaArquivo.value = '';
  });
  desenharCapa();

  // ---- capitulos: todos os documentos, na ordem da arvore; marcados = o que esta no ar (ou o manuscrito, na 1a vez)
  const todos = docsDoProjeto(itens);
  const marcados = new Set(P.capitulos.length ? P.capitulos.map((c) => c.doc_id) : docsDoManuscrito(itens).map((d) => d.id));
  const resumoCaps = h('p', { class: 'hint', role: 'status' });
  const caixas = new Map();
  const listaCaps = h('ul', { class: 'st-pub-caps' }, todos.map((d) => {
    const cx = h('input', { type: 'checkbox', checked: marcados.has(d.id) || null, onchange: atualizarResumo });
    caixas.set(d.id, cx);
    return h('li', null, h('label', null, cx,
      h('span', null, d.titulo || 'Sem título'),
      h('small', null, `${d.caminho.length ? d.caminho.join(' / ') + ' · ' : ''}${TIPOS_DOC[d.doc_tipo] || d.doc_tipo} · ${milhar(d.palavras)} palavras`),
      PROSA.includes(d.doc_tipo) ? null : h('small', { class: 'st-pub-alerta' }, 'não é capítulo: confira se deve ir para o leitor')));
  }));
  const escolhidos = () => todos.filter((d) => caixas.get(d.id).checked);
  function atualizarResumo() {
    const e = escolhidos();
    resumoCaps.textContent = `${e.length} documento(s) escolhido(s), ${milhar(e.reduce((s, d) => s + (d.palavras || 0), 0))} palavras. A ordem é a da estrutura da obra: para mudar, arraste no explorador.`;
  }
  atualizarResumo();

  // ---- quando
  const agora = h('input', { type: 'radio', name: 'st-pub-quando', value: 'agora', checked: true });
  const agendar = h('input', { type: 'radio', name: 'st-pub-quando', value: 'agendar' });
  const data = h('input', { type: 'datetime-local', class: 'st-campo', disabled: true, value: paraCampoData(P.agendada_para || Math.floor(Date.now() / 1000) + 86400) });
  for (const r of [agora, agendar]) r.addEventListener('change', () => { data.disabled = !agendar.checked; atualizarBotao(); });
  const quando = P.no_ar
    ? h('p', { class: 'hint' }, 'A obra já está no ar: ao confirmar, a versão publicada é substituída por esta.')
    : h('fieldset', { class: 'st-pub-quando' }, h('legend', null, 'Quando'),
      h('label', null, agora, ' Publicar agora'), h('label', null, agendar, ' Agendar para '), data);

  // ---- declaracao
  const aceite = h('input', { type: 'checkbox', onchange: () => atualizarBotao() });
  const declaracao = P.declaracao
    ? h('div', { class: 'st-pub-dec' },
      h('h3', null, 'Declaração de autoria'),
      h('p', null, P.declaracao.texto),
      P.declaracao.provisoria ? h('p', { class: 'hint' }, `Texto provisório (versão ${P.declaracao.versao}), sujeito a revisão.`) : null,
      h('label', { class: 'st-pub-aceite' }, aceite, ' Li e aceito a declaração acima.'))
    : h('p', { class: 'hint' }, 'A declaração de autoria não está disponível agora.');

  // ---- botoes
  const ok = h('button', { type: 'button', class: 'btn btn-primary', onclick: confirmarPublicacao });
  const previa = h('button', { type: 'button', class: 'btn btn-ghost', onclick: abrirPrevia }, 'Prévia');
  const tirar = P.no_ar || P.agendada_para ? h('button', { type: 'button', class: 'btn btn-ghost', onclick: tirarDoAr }, P.no_ar ? 'Tirar do ar' : 'Cancelar agendamento') : null;
  const fechar = h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => dlg.close() }, 'Fechar');
  function atualizarBotao() {
    ok.textContent = P.no_ar ? 'Atualizar publicação' : agendar.checked ? 'Agendar' : 'Publicar';
    ok.disabled = !P.ligada || !aceite.checked;
  }
  atualizarBotao();

  let ocupado = false;
  const travar = (sim) => { ocupado = sim; for (const b of [ok, previa, fechar, tirar]) if (b) b.disabled = sim; if (!sim) atualizarBotao(); };

  async function confirmarPublicacao() {
    const docs = escolhidos();
    if (!docs.length) { estado.textContent = 'Escolha pelo menos um capítulo.'; return; }
    if (!sinopse.value.trim()) { estado.textContent = 'Escreva uma sinopse: é ela que apresenta a obra ao leitor.'; sinopse.focus(); return; }
    if (!faixaEscolhida()) { estado.textContent = 'Escolha a classificação indicativa: para qual faixa etária a obra é recomendada.'; faixaCaixas[0].focus(); return; }
    const dados = {
      acao: !P.no_ar && agendar.checked ? 'agendar' : 'publicar', aceite: P.declaracao && P.declaracao.versao,
      meta: { titulo: titulo.value, genero: genero.value, sinopse: sinopse.value, creditos: creditos.value, capa, faixa: faixaEscolhida() },
      docs: docs.map((d) => d.id),
    };
    if (dados.acao === 'agendar') {
      const t = Math.floor(new Date(data.value).getTime() / 1000);
      if (!t) { estado.textContent = 'Escolha a data e a hora.'; return; }
      dados.quando = t;
    }
    travar(true); estado.textContent = 'Salvando o que estava pendente...';
    try {
      if (antes) await antes(); // a copia publica sai do que esta gravado no servidor
      estado.textContent = 'Publicando...';
      const r = await api.publicar(obraId, dados);
      travar(false); dlg.close();
      if (aoMudar) aoMudar(r.status);
      dialogo({
        titulo: r.status === 'agendado' ? 'Publicação agendada' : r.status === 'atualizado' ? 'Publicação atualizada' : 'Obra publicada',
        corpo: [
          h('p', null, r.status === 'agendado' ? `“${dados.meta.titulo}” entra no ar em ${dataHora(r.agendada_para)}, com ${r.capitulos} capítulo(s).` : `“${dados.meta.titulo}” está no ar com ${r.capitulos} capítulo(s).`),
          h('p', { class: 'hint' }, 'O que você editar daqui em diante fica só no Estúdio, até você atualizar a publicação.'),
          r.status === 'agendado' ? null : h('p', null, h('a', { class: 'btn btn-primary', href: r.url, target: '_blank', rel: 'noopener' }, 'Abrir a página de leitura')),
        ],
      });
    } catch (e) { travar(false); estado.textContent = e.message; }
  }

  async function tirarDoAr() {
    const msg = P.no_ar ? 'Os leitores deixam de ver a obra na hora. Seu texto continua no Estúdio e você pode publicar de novo quando quiser, no mesmo endereço.' : 'A obra não vai mais entrar no ar na data marcada.';
    if (!(await confirmar(P.no_ar ? 'Tirar a obra do ar?' : 'Cancelar o agendamento?', msg, P.no_ar ? 'Tirar do ar' : 'Cancelar agendamento', true))) return;
    travar(true);
    try { const r = await api.despublicar(obraId); travar(false); dlg.close(); if (aoMudar) aoMudar(r.status); }
    catch (e) { travar(false); estado.textContent = e.message; }
  }

  // previa: o texto exatamente como o leitor vai ver (sem [[links]] e #tags), capitulo por capitulo
  async function abrirPrevia() {
    const docs = escolhidos();
    if (!docs.length) { estado.textContent = 'Escolha pelo menos um capítulo para ver a prévia.'; return; }
    travar(true); estado.textContent = 'Preparando a prévia...';
    let m;
    try { if (antes) await antes(); m = await carregarLeitura(); } catch (e) { travar(false); estado.textContent = e.message; return; }
    travar(false); estado.textContent = '';
    const texto = h('article', { class: 'ler-texto st-pub-previa' });
    const sel = h('select', { class: 'st-campo', 'aria-label': 'Capítulo da prévia' }, docs.map((d, i) => h('option', { value: d.id }, `${i + 1}. ${d.titulo}`)));
    const mostrar = async () => {
      texto.replaceChildren(h('p', { class: 'hint' }, 'Carregando...'));
      try { const d = await api.doc(obraId, sel.value); texto.replaceChildren(h('h2', null, d.titulo), m.renderizar(d.corpo, { privado: true })); }
      catch (e) { texto.replaceChildren(h('p', null, e.message)); }
    };
    sel.addEventListener('change', mostrar);
    const p = dialogo({ titulo: 'Prévia: ' + (titulo.value || obra.titulo), corpo: [sel, texto], largo: true });
    mostrar();
    await p;
  }

  dlg.append(
    h('h2', { id: 'st-pub-t' }, P.no_ar ? 'Atualizar publicação' : 'Publicar obra'),
    h('div', { class: 'st-dialogo-corpo' },
      P.ligada ? null : h('p', { class: 'st-pub-sit' }, 'A publicação ainda não está liberada no Entrelinhas. Você pode preparar tudo e ver a prévia.'),
      situacao,
      h('p', { class: 'hint' }, `Status no Estúdio: ${STATUS_OBRA[P.status] || P.status}.`),
      f('Título', titulo), f('Gênero', genero), f('Sinopse', sinopse, 'Obrigatória. Aparece na biblioteca e na página da obra.'),
      h('div', { class: 'fld' }, h('span', null, 'Classificação indicativa (faixa etária)'), faixaCampo, h('small', { class: 'hint' }, 'Obrigatória. Escolha a partir de que idade a obra é recomendada, pensando em violência, sexo, drogas e linguagem.')),
      f('Créditos', creditos),
      h('div', { class: 'fld' }, h('span', null, 'Capa'), capaImg, capaArquivo, capaTirar),
      h('div', { class: 'fld' }, h('span', null, 'O que vai para o leitor'), listaCaps, resumoCaps,
        h('small', { class: 'hint' }, 'Notas, fichas e pesquisa só vão se você marcar. [[Links]] viram texto comum e #tags somem.')),
      quando, declaracao, estado),
    h('div', { class: 'st-dialogo-rodape' }, tirar, fechar, previa, ok));
  dlg.addEventListener('cancel', (e) => { if (ocupado) e.preventDefault(); });
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg); dlg.showModal();
}
