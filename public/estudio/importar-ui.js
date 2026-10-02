// Importar manuscrito: ARQUIVO -> PROCESSAR -> CONFERIR -> IMPORTAR. Tudo no navegador; o servidor so recebe capitulos prontos.
import { h, milhar } from './ui.js';
import { api } from './api.js';

const MODOS = [
  ['auto', 'Detectar automaticamente'], ['h1', 'Títulos de nível 1 (#)'], ['h2', 'Títulos de nível 2 (##)'],
  ['padrao', 'Linhas como “Capítulo 1”, “Prólogo”, “Parte II”'], ['nenhum', 'Não dividir (um único documento)'],
];
const LIM_CORPO = 400000;   // igual ao limite do servidor
const LIM_ORIGINAL = 1500000;
const palavras = (t) => (String(t || '').match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) || []).length;

let modulo = null;
const carregar = () => modulo || (modulo = import('../vendor/estudio-importar.js'));

// obraId null = criar uma obra nova com o manuscrito. Retorna { obraId, primeiro, n, falhas } ou null se cancelou.
export function importarManuscrito({ obraId = null, pastaId = null, docTipo = 'capitulo' } = {}) {
  return new Promise((resolve) => {
    const S = { arquivo: null, lido: null, modo: 'auto', caps: [], guardar: true, tituloObra: '', importando: false };
    let resultado = null;
    const dlg = h('dialog', { class: 'st-dialogo largo st-import', 'aria-labelledby': 'st-imp-t' });
    const corpo = h('div', { class: 'st-dialogo-corpo' });
    const rodape = h('div', { class: 'st-dialogo-rodape' });
    dlg.append(h('h2', { id: 'st-imp-t' }, 'Importar manuscrito'), corpo, rodape);
    dlg.addEventListener('cancel', (e) => { if (S.importando) e.preventDefault(); }); // nao fecha no meio da importacao
    dlg.addEventListener('close', () => { dlg.remove(); resolve(resultado); });
    const botao = (rotulo, classe, onclick, extra) => h('button', { type: 'button', class: 'btn ' + classe, onclick, ...(extra || {}) }, rotulo);
    const fechar = () => dlg.close();
    const tela = (conteudo, botoes) => { corpo.replaceChildren(...[].concat(conteudo)); rodape.replaceChildren(...botoes); };

    // ---------- 1. escolher o arquivo
    function telaArquivo(erro) {
      const entrada = h('input', { type: 'file', accept: '.docx,.txt,.md,.markdown', class: 'st-drop-input', 'aria-label': 'Escolher arquivo do manuscrito', onchange: () => entrada.files[0] && processar(entrada.files[0]) });
      const zona = h('label', { class: 'st-drop' }, h('strong', null, 'Arraste o arquivo para cá'), h('span', null, 'ou clique para escolher'), h('small', null, 'DOCX, TXT ou Markdown (até 25 MB)'), entrada);
      for (const ev of ['dragenter', 'dragover']) zona.addEventListener(ev, (e) => { e.preventDefault(); zona.classList.add('sobre'); });
      for (const ev of ['dragleave', 'drop']) zona.addEventListener(ev, (e) => { e.preventDefault(); zona.classList.remove('sobre'); });
      zona.addEventListener('drop', (e) => { const f = e.dataTransfer.files[0]; if (f) processar(f); });
      tela([h('p', null, 'Traga o texto que você já tem. Ele vira capítulos editáveis no Estúdio e o arquivo original continua com você.'), zona, erro ? h('p', { class: 'st-erro', role: 'alert' }, erro) : null,
        h('p', { class: 'hint' }, 'Negrito, itálico, títulos, listas, citações e separadores de cena são mantidos. Imagens não são importadas.')],
      [botao('Cancelar', 'btn-ghost', fechar)]);
    }

    // ---------- 2. processar
    async function processar(arquivo) {
      S.arquivo = arquivo;
      tela([h('p', { role: 'status' }, `Lendo “${arquivo.name}”...`), h('div', { class: 'st-prog', 'aria-hidden': 'true' }, h('span', { style: 'width:40%' }))], []);
      try {
        const m = await carregar();
        S.lido = await m.lerArquivo(arquivo);
        S.tituloObra = S.lido.titulo;
        S.guardar = arquivo.size <= LIM_ORIGINAL;
        await recalcular();
        if (S.lido.tituloLivro) S.tituloObra = S.lido.tituloLivro; // folha de titulo do Word vira o nome da obra
        telaConferir();
      } catch (e) { telaArquivo(e.message || 'Não foi possível ler o arquivo.'); }
    }

    let modoUsado = 'nenhum';
    async function recalcular() {
      const m = await carregar();
      modoUsado = S.modo === 'auto' ? m.sugerirModo(S.lido.markdown) : S.modo;
      S.caps = m.dividirCapitulos(S.lido.markdown, modoUsado, S.lido.titulo).map((c) => ({ ...c, incluir: true }));
      if (!S.lido.tituloLivro) S.lido.tituloLivro = m.tituloDoLivro(S.lido.markdown, modoUsado) || '';
    }

    // ---------- 3. conferir
    function telaConferir() {
      const incluidos = S.caps.filter((c) => c.incluir);
      const grandes = incluidos.filter((c) => c.corpo.length > LIM_CORPO);
      const total = incluidos.reduce((s, c) => s + c.palavras, 0);
      const seletorModo = h('select', { class: 'st-campo', 'aria-label': 'Como dividir em capítulos', onchange: async (e) => { S.modo = e.target.value; await recalcular(); telaConferir(); } },
        MODOS.map(([v, t]) => h('option', { value: v, selected: v === S.modo }, v === 'auto' ? `${t} (${rotuloModo(modoUsado)})` : t)));
      const campoObra = obraId ? null : h('label', { class: 'fld' }, h('span', null, 'Título da nova obra'),
        h('input', { class: 'st-campo', type: 'text', maxlength: '200', value: S.tituloObra, oninput: (e) => { S.tituloObra = e.target.value; atualizarBotao(); } }));
      const lista = h('ol', { class: 'st-imp-lista' }, S.caps.map((c, i) => h('li', { class: 'st-imp-cap' + (c.incluir ? '' : ' fora') },
        h('input', { type: 'checkbox', checked: c.incluir || null, 'aria-label': `Importar “${c.titulo}”`, onchange: (e) => { c.incluir = e.target.checked; telaConferir(); } }),
        h('div', { class: 'st-imp-meio' },
          h('input', { class: 'st-campo st-imp-titulo', type: 'text', maxlength: '200', value: c.titulo, 'aria-label': `Título do capítulo ${i + 1}`, oninput: (e) => { c.titulo = e.target.value; } }),
          h('small', null, `${milhar(c.palavras)} palavras`, c.corpo.length > LIM_CORPO ? h('b', { class: 'st-erro' }, ' · passou de 400 mil caracteres: divida em capítulos') : null),
          h('p', { class: 'st-imp-previa' }, c.corpo.replace(/\s+/g, ' ').slice(0, 140) || '(sem texto)')),
        i > 0 ? h('button', { type: 'button', class: 'btn btn-ghost st-imp-unir', title: 'Juntar o texto deste capítulo ao anterior', onclick: () => unir(i) }, 'Unir ao anterior') : h('span'))));
      const original = S.arquivo.size <= LIM_ORIGINAL
        ? h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: S.guardar || null, onchange: (e) => { S.guardar = e.target.checked; } }), ' Guardar o arquivo original, privado, junto da obra')
        : h('p', { class: 'hint' }, 'O arquivo tem mais de 1,5 MB: o texto será importado, mas o original não pode ser guardado aqui.');
      const importar = botao(`Importar ${incluidos.length} ${incluidos.length === 1 ? 'documento' : 'documentos'}`, 'btn-primary', executar, { id: 'st-imp-ok', disabled: (!incluidos.length || grandes.length || (!obraId && !S.tituloObra.trim())) || null });
      function atualizarBotao() { importar.disabled = !incluidos.length || grandes.length > 0 || (!obraId && !S.tituloObra.trim()); }
      tela([
        h('p', { role: 'status' }, h('b', null, `${incluidos.length} ${incluidos.length === 1 ? 'capítulo' : 'capítulos'}`), ` · ${milhar(total)} palavras · de “${S.arquivo.name}”`),
        h('label', { class: 'fld' }, h('span', null, 'Como dividir'), seletorModo), campoObra,
        ...S.lido.avisos.map((a) => h('p', { class: 'st-aviso-imp' }, a)),
        h('p', { class: 'hint' }, 'Confira os títulos, desmarque o que não deve entrar e una trechos que foram separados sem querer. Você poderá editar tudo depois.'),
        lista, original,
        h('p', { class: 'hint' }, obraId ? 'Os documentos serão criados na pasta escolhida desta obra.' : 'Uma obra nova será criada com a pasta Manuscrito já preenchida.'),
      ], [botao('Escolher outro arquivo', 'btn-ghost', () => telaArquivo()), botao('Cancelar', 'btn-ghost', fechar), importar]);
    }
    const rotuloModo = (m) => ({ h1: 'títulos de nível 1', h2: 'títulos de nível 2', padrao: 'linhas “Capítulo N”', nenhum: 'sem divisão' }[m] || m);

    function unir(i) {
      const a = S.caps[i - 1], b = S.caps[i];
      a.corpo = [a.corpo, b.corpo].filter(Boolean).join('\n\n'); a.palavras = palavras(a.corpo);
      S.caps.splice(i, 1); telaConferir();
    }

    // ---------- 4. importar
    async function executar() {
      S.importando = true;
      const alvo = S.caps.filter((c) => c.incluir);
      const barra = h('span', { style: 'width:0%' });
      const texto = h('p', { role: 'status' }, 'Preparando...');
      tela([texto, h('div', { class: 'st-prog', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(alvo.length) }, barra),
        h('p', { class: 'hint' }, 'Não feche esta janela até terminar. Cada capítulo é salvo assim que é criado.')], []);
      const falhas = [], criados = [];
      let id = obraId, pasta = pastaId;
      try {
        if (!id) {
          const r = await api.criarObra(S.tituloObra.trim(), 'texto'); id = r.id;
          const w = await api.obra(id); pasta = (w.itens.find((i) => i.doc_tipo === 'manuscrito') || {}).id || null;
        }
        for (let i = 0; i < alvo.length; i++) {
          texto.textContent = `Criando ${i + 1} de ${alvo.length}: ${alvo[i].titulo}`;
          try { const r = await api.criarDoc(id, { pai: pasta, doc_tipo: docTipo, titulo: alvo[i].titulo.trim() || 'Sem título', corpo: alvo[i].corpo }); criados.push(r.id); }
          catch (e) { falhas.push({ titulo: alvo[i].titulo, erro: e.message }); }
          barra.style.width = `${Math.round(((i + 1) / alvo.length) * 100)}%`;
        }
        if (S.guardar && S.arquivo.size <= LIM_ORIGINAL && criados.length) {
          try { await window.EL.api(`/api/studio/works/${id}/files?nome=${encodeURIComponent(S.arquivo.name)}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: S.arquivo }); }
          catch (e) { falhas.push({ titulo: 'Arquivo original', erro: e.message }); }
        }
      } catch (e) { falhas.push({ titulo: 'Criação da obra', erro: e.message }); }
      S.importando = false;
      resultado = { obraId: id, primeiro: criados[0] || null, n: criados.length, falhas };
      telaFim(resultado, alvo.reduce((s, c) => s + c.palavras, 0));
    }

    function telaFim(r, pal) {
      tela([
        h('p', { role: 'status' }, h('b', null, r.n ? `Pronto: ${r.n} ${r.n === 1 ? 'documento importado' : 'documentos importados'}` : 'Nada foi importado'), r.n ? ` (${milhar(pal)} palavras).` : '.'),
        ...(r.falhas.length ? [h('p', { class: 'st-erro' }, 'Alguns itens não foram importados:'), h('ul', null, r.falhas.map((f) => h('li', null, `${f.titulo}: ${f.erro}`)))] : []),
        h('p', { class: 'hint' }, 'O texto importado já está no Estúdio. Dá para editar, reorganizar e linkar como qualquer outro documento.'),
      ], [botao(r.n ? 'Abrir o manuscrito' : 'Fechar', 'btn-primary', fechar)]);
    }

    document.body.append(dlg); dlg.showModal(); telaArquivo();
  });
}
