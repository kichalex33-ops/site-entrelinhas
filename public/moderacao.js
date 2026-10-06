// Painel de moderacao na conta: gerar link de nova senha para qualquer conta (autor ou leitor).
// Aparece sozinho na area logada do autor quando ele e moderador (a API responde 403 para os demais).
(function () {
  'use strict';
  if (!window.EL) return;
  const { api, esc } = EL;
  const app = document.getElementById('app');
  if (!app) return;
  let carregando = false;

  async function montar() {
    if (carregando || app.dataset.mod !== '1' || document.getElementById('mod-panel') || !app.querySelector('#ed')) return;
    carregando = true;
    let contas = null;
    try { contas = await api('/api/admin/contas'); } catch { /* nao e moderador */ }
    carregando = false;
    if (!contas || document.getElementById('mod-panel') || !app.querySelector('#ed')) return;

    const sec = document.createElement('details');
    sec.id = 'mod-panel';
    sec.className = 'blk';
    sec.innerHTML = `<summary>Moderação · recuperar senha de alguém</summary>
      <p class="hint">Gere um link de uso único (vale 30 minutos) e entregue à pessoa por um canal confiável, como WhatsApp ou mensagem direta. Gerar de novo invalida o link anterior.</p>
      <label class="fld"><span>Buscar por nome ou e-mail</span><input type="search" id="mod-busca" autocomplete="off"></label>
      <div id="mod-lista"></div>`;
    app.appendChild(sec);
    const lista = sec.querySelector('#mod-lista');
    const busca = sec.querySelector('#mod-busca');

    const desenhar = () => {
      const q = busca.value.trim().toLowerCase();
      const vis = contas.filter((c) => !q || c.nome.toLowerCase().includes(q) || c.email.includes(q)).slice(0, 50);
      lista.innerHTML = vis.map((c) => `<div class="item mod-conta">
          <div><strong>${esc(c.nome)}</strong> <span class="hint">${c.role === 'leitor' ? 'leitor' : 'autor'}${c.mod ? ' · moderador' : ''}</span><div class="hint">${esc(c.email)}</div></div>
          <button type="button" class="btn btn-ghost" data-email="${esc(c.email)}">Gerar link</button>
          <div class="mod-saida"></div>
        </div>`).join('') || '<p class="hint">Nenhuma conta encontrada.</p>';
    };
    busca.addEventListener('input', desenhar);
    desenhar();

    lista.addEventListener('click', async (e) => {
      const btn = e.target.closest('button[data-email]');
      if (!btn) return;
      const out = btn.parentElement.querySelector('.mod-saida');
      btn.disabled = true;
      try {
        const r = await api('/api/admin/reset-link', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: btn.dataset.email }) });
        out.innerHTML = `<div class="mod-link"><input readonly value="${esc(r.link)}" aria-label="Link de nova senha"><button type="button" class="btn btn-ghost" data-copiar>Copiar</button></div>
          <p class="hint">Vale ${r.expira_em_min} minutos e só funciona uma vez.</p>`;
        const inp = out.querySelector('input');
        inp.addEventListener('focus', () => inp.select());
        out.querySelector('[data-copiar]').addEventListener('click', async (ev) => {
          try { await navigator.clipboard.writeText(inp.value); ev.target.textContent = 'Copiado'; } catch { inp.select(); }
        });
        btn.textContent = 'Gerar outro';
      } catch (err) {
        out.innerHTML = `<p class="note err" role="status">${esc(err.message || 'Não foi possível gerar o link.')}</p>`;
      }
      btn.disabled = false;
    });
  }

  // ---------- convidar autor ----------
  const data = (s) => new Date(s * 1000).toLocaleDateString('pt-BR');
  const SITUACAO = { aberto: 'aguardando cadastro', usado: 'usado', expirado: 'expirado' };
  let montandoConvites = false;

  async function montarConvites() {
    if (montandoConvites || document.getElementById('mod-convites') || !document.getElementById('mod-panel')) return;
    montandoConvites = true;
    const sec = document.createElement('details');
    sec.id = 'mod-convites';
    sec.className = 'blk';
    sec.innerHTML = `<summary>Moderação · convidar autor</summary>
      <p class="hint">O cadastro de autor só abre com convite. Cada código serve para uma pessoa e vale 14 dias. Mande o link pronto (WhatsApp ou mensagem direta): ele abre o cadastro com o código preenchido.</p>
      <form id="mod-conv-form" class="mod-conv-form">
        <label class="fld"><span>Para quem (só para você lembrar)</span><input name="para" maxlength="80" autocomplete="off" placeholder="ex.: Maria, do grupo de contos"></label>
        <button class="btn btn-primary" type="submit">Gerar convite</button>
      </form>
      <div id="mod-conv-saida"></div>
      <h4 class="st-sub">Convites recentes</h4>
      <div id="mod-conv-lista"><p class="hint">Carregando...</p></div>`;
    document.getElementById('mod-panel').after(sec);
    montandoConvites = false;

    const lista = sec.querySelector('#mod-conv-lista');
    const recarregar = async () => {
      let cs = [];
      try { cs = await api('/api/admin/convites'); } catch (e) { lista.innerHTML = `<p class="note err">${esc(e.message)}</p>`; return; }
      lista.innerHTML = cs.length ? `<ul class="mod-conv-ul">${cs.map((c) => `<li><b>${esc(c.para || 'sem anotação')}</b> <span class="hint">· ${data(c.criado_em)} por ${esc(c.por || '?')} · ${SITUACAO[c.situacao]}${c.usado_por ? ` (<a href="autor.html?a=${encodeURIComponent(c.usado_por)}">ver perfil</a>)` : ''}</span></li>`).join('')}</ul>` : '<p class="hint">Nenhum convite gerado pelo painel ainda.</p>';
    };
    recarregar();

    sec.querySelector('#mod-conv-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target, btn = f.querySelector('button'), out = sec.querySelector('#mod-conv-saida');
      btn.disabled = true;
      try {
        const r = await api('/api/admin/convites', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ para: f.para.value }) });
        const msg = `Você foi convidado para o Entrelinhas, o coletivo de escritores independentes! Crie sua conta de autor por este link: ${r.link}\n(Se pedir, o código é ${r.codigo}. Vale ${r.expira_em_dias} dias e é só seu.)`;
        out.innerHTML = `<div class="mod-conv-ok"><p>Código: <b class="mod-codigo">${esc(r.codigo)}</b></p>
            <textarea readonly rows="4" aria-label="Mensagem de convite">${esc(msg)}</textarea>
            <button type="button" class="btn btn-ghost" data-copiar>Copiar mensagem</button>
            <p class="hint">O código só aparece agora. Se perder, gere outro.</p></div>`;
        out.querySelector('[data-copiar]').addEventListener('click', async (ev) => {
          try { await navigator.clipboard.writeText(msg); ev.target.textContent = 'Copiado'; } catch { out.querySelector('textarea').select(); }
        });
        f.reset();
        recarregar();
      } catch (err) {
        out.innerHTML = `<p class="note err" role="status">${esc(err.message)}</p>`;
      }
      btn.disabled = false;
    });
  }

  // ---------- denuncias de livros ----------
  let montandoDen = false;
  async function montarDenuncias() {
    const conv = document.getElementById('mod-convites');
    if (montandoDen || document.getElementById('mod-denuncias') || !conv) return;
    montandoDen = true;
    const sec = document.createElement('details');
    sec.id = 'mod-denuncias';
    sec.className = 'blk';
    sec.innerHTML = `<summary>Moderação · denúncias de livros <span class="mod-badge" hidden></span></summary>
      <p class="hint">Plágio, pirataria, publicação sem autorização, IA sem aviso, classificação errada... Analise, fale com o autor se preciso e registre a decisão. O autor vê os motivos em análise, nunca quem denunciou.</p>
      <label class="mod-todas"><input type="checkbox" id="mod-den-todas"> Mostrar também as já decididas</label>
      <div id="mod-den-lista"><p class="hint">Carregando...</p></div>`;
    conv.after(sec);
    montandoDen = false;
    const lista = sec.querySelector('#mod-den-lista'), badge = sec.querySelector('.mod-badge'), todas = sec.querySelector('#mod-den-todas');
    const recarregar = async () => {
      let ds = [];
      try { ds = await api('/api/admin/denuncias-livros' + (todas.checked ? '?todas=1' : '')); } catch (e) { lista.innerHTML = `<p class="note err">${esc(e.message)}</p>`; return; }
      const abertas = ds.filter((d) => d.status === 'aberta').length;
      badge.hidden = !abertas; badge.textContent = abertas;
      if (!ds.length) { lista.innerHTML = '<p class="hint">Nenhuma denúncia aberta. 🎉</p>'; return; }
      const grupos = new Map();
      for (const d of ds) { const k = d.autor_slug + '/' + d.obra_id; if (!grupos.has(k)) grupos.set(k, []); grupos.get(k).push(d); }
      lista.innerHTML = [...grupos.entries()].map(([k, itens]) => {
        const [a, o] = k.split('/');
        return `<div class="mod-den-grupo"><p><a href="obra.html?a=${encodeURIComponent(a)}&o=${encodeURIComponent(o)}" target="_blank" rel="noopener"><b>${esc(itens[0].titulo || 'Ver o livro')}</b></a> <span class="hint">de ${esc(a)} · ${itens.length} denúncia(s)</span></p>
          ${itens.map((d) => `<div class="mod-den" data-id="${d.id}">
            <p><b>${esc(d.rotulo)}</b> <span class="hint">· por ${esc(d.quem)} em ${data(d.created_at)}${d.status !== 'aberta' ? ` · ${d.status} por ${esc(d.moderador || '?')}` : ''}</span></p>
            ${d.detalhe ? `<p class="mod-den-txt">${esc(d.detalhe)}</p>` : ''}
            ${d.link ? `<p><a href="${esc(d.link)}" target="_blank" rel="noopener noreferrer nofollow">Link do original indicado &#8599;</a></p>` : ''}
            ${d.status === 'aberta' ? `<div class="mod-den-acoes"><input class="mod-den-nota" maxlength="500" placeholder="Anotação da decisão (opcional)" aria-label="Anotação"><button type="button" class="btn btn-primary" data-acao="resolver">Ação tomada</button><button type="button" class="btn btn-ghost" data-acao="arquivar">Arquivar (sem problema)</button></div>` : d.nota ? `<p class="hint">Nota: ${esc(d.nota)}</p>` : ''}
          </div>`).join('')}</div>`;
      }).join('');
    };
    todas.addEventListener('change', recarregar);
    lista.addEventListener('click', async (e) => {
      const b = e.target.closest('button[data-acao]'); if (!b) return;
      const box = b.closest('.mod-den');
      b.disabled = true;
      try {
        await api('/api/admin/denuncias-livros/' + box.dataset.id, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acao: b.dataset.acao, nota: box.querySelector('.mod-den-nota').value }) });
        recarregar();
      } catch (err) { b.disabled = false; box.insertAdjacentHTML('beforeend', `<p class="note err">${esc(err.message)}</p>`); }
    });
    recarregar();
  }

  // ---------- denuncias de avaliacoes ----------
  // Antes so eram gravadas. Ocultar tira a avaliacao do ar (e da nota media); manter arquiva as denuncias.
  let montandoAv = false;
  async function montarDenunciasAvaliacoes() {
    const den = document.getElementById('mod-denuncias');
    if (montandoAv || document.getElementById('mod-den-av') || !den) return;
    montandoAv = true;
    const sec = document.createElement('details');
    sec.id = 'mod-den-av';
    sec.className = 'blk';
    sec.innerHTML = `<summary>Moderação · denúncias de avaliações <span class="mod-badge" hidden></span></summary>
      <p class="hint">Avaliações denunciadas por spoiler, ofensa ou spam. Quem escreveu não fica sabendo quem denunciou.</p>
      <label class="mod-todas"><input type="checkbox" id="mod-av-todas"> Mostrar também as já decididas</label>
      <div id="mod-av-lista"><p class="hint">Carregando...</p></div>`;
    den.after(sec);
    montandoAv = false;
    const lista = sec.querySelector('#mod-av-lista'), badge = sec.querySelector('.mod-badge'), todas = sec.querySelector('#mod-av-todas');
    const recarregar = async () => {
      let av = [];
      try { av = await api('/api/admin/denuncias-avaliacoes' + (todas.checked ? '?todas=1' : '')); } catch (e) { lista.innerHTML = `<p class="note err">${esc(e.message)}</p>`; return; }
      const abertas = av.filter((a) => a.denuncias.some((d) => d.status === 'aberta')).length;
      badge.hidden = !abertas; badge.textContent = abertas;
      if (!av.length) { lista.innerHTML = '<p class="hint">Nenhuma avaliação denunciada.</p>'; return; }
      lista.innerHTML = av.map((a) => {
        const aberta = a.denuncias.some((d) => d.status === 'aberta');
        return `<div class="mod-den" data-id="${a.id}">
          <p><a href="obra.html?a=${encodeURIComponent(a.autor_slug)}&o=${encodeURIComponent(a.obra_id)}" target="_blank" rel="noopener"><b>${esc(a.titulo || 'Ver o livro')}</b></a>
            <span class="hint">· avaliação de ${esc(a.escreveu)} (${'★'.repeat(a.nota)}) em ${data(a.em)}${a.oculta ? ' · <b>oculta</b>' : ''}</span></p>
          <p class="mod-den-txt">${esc(a.texto)}</p>
          <ul class="mod-av-den">${a.denuncias.map((d) => `<li>${esc(d.rotulo)} <span class="hint">· por ${esc(d.quem)} em ${data(d.em)}${d.status !== 'aberta' ? ` · ${esc(d.status)} por ${esc(d.moderador || '?')}` : ''}</span></li>`).join('')}</ul>
          ${aberta ? '<div class="mod-den-acoes"><button type="button" class="btn btn-primary" data-acao="ocultar">Ocultar avaliação</button><button type="button" class="btn btn-ghost" data-acao="manter">Manter (sem problema)</button></div>' : ''}
        </div>`;
      }).join('');
    };
    todas.addEventListener('change', recarregar);
    lista.addEventListener('click', async (e) => {
      const b = e.target.closest('button[data-acao]'); if (!b) return;
      const box = b.closest('.mod-den');
      b.disabled = true;
      try {
        await api('/api/admin/denuncias-avaliacoes/' + box.dataset.id, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acao: b.dataset.acao }) });
        recarregar();
      } catch (err) { b.disabled = false; box.insertAdjacentHTML('beforeend', `<p class="note err">${esc(err.message)}</p>`); }
    });
    recarregar();
  }

  // ---------- feedback do beta (feedback.html) ----------
  let montandoFb = false;
  async function montarFeedback() {
    const ref = document.getElementById('mod-den-av');
    if (montandoFb || document.getElementById('mod-feedback') || !ref) return;
    montandoFb = true;
    const sec = document.createElement('details');
    sec.id = 'mod-feedback';
    sec.className = 'blk';
    sec.innerHTML = `<summary>Moderação · feedback do beta <span class="mod-badge" hidden></span></summary>
      <p class="hint">O que os testadores mandaram pela página de feedback. Marque como visto depois de ler (ou de abrir a tarefa).</p>
      <label class="mod-todas"><input type="checkbox" id="mod-fb-todos"> Mostrar também os já vistos</label>
      <div id="mod-fb-lista"><p class="hint">Carregando...</p></div>`;
    ref.after(sec);
    montandoFb = false;
    const lista = sec.querySelector('#mod-fb-lista'), badge = sec.querySelector('.mod-badge'), todos = sec.querySelector('#mod-fb-todos');
    const recarregar = async () => {
      let fs = [];
      try { fs = await api('/api/admin/feedback' + (todos.checked ? '?todos=1' : '')); } catch (e) { lista.innerHTML = `<p class="note err">${esc(e.message)}</p>`; return; }
      const novos = fs.filter((f) => f.status === 'novo').length;
      badge.hidden = !novos; badge.textContent = novos;
      if (!fs.length) { lista.innerHTML = '<p class="hint">Nenhum feedback novo.</p>'; return; }
      lista.innerHTML = fs.map((f) => `<div class="mod-den" data-id="${f.id}">
        <p><b>${esc(f.categoria_rotulo)}</b> <span class="hint">· ${esc(f.area_rotulo)}${f.pagina ? ' · ' + esc(f.pagina) : ''} · ${f.quem ? 'por ' + esc(f.quem) : 'sem conta'} em ${data(f.created_at)}${f.status === 'visto' ? ' · visto' : ''}</span></p>
        <p class="mod-den-txt">${esc(f.descricao)}</p>
        <div class="mod-den-acoes"><button type="button" class="btn btn-ghost" data-status="${f.status === 'novo' ? 'visto' : 'novo'}">${f.status === 'novo' ? 'Marcar como visto' : 'Voltar para novo'}</button></div>
      </div>`).join('');
    };
    todos.addEventListener('change', recarregar);
    lista.addEventListener('click', async (e) => {
      const b = e.target.closest('button[data-status]'); if (!b) return;
      b.disabled = true;
      try {
        await api('/api/admin/feedback/' + b.closest('.mod-den').dataset.id, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: b.dataset.status }) });
        recarregar();
      } catch (err) { b.disabled = false; b.insertAdjacentHTML('afterend', `<p class="note err">${esc(err.message)}</p>`); }
    });
    recarregar();
  }

  // ---------- mensagens do contato@entrelinhasbr.com.br ----------
  // Chegam pelo Email Routing (src/contato.js). Cada moderador le com a propria conta; responder abre o e-mail de quem
  // modera, com destinatario e assunto prontos. Uma copia de tudo fica na caixa do Proton.
  let montandoMsg = false;
  async function montarMensagens() {
    const ref = document.getElementById('mod-feedback');
    if (montandoMsg || document.getElementById('mod-mensagens') || !ref) return;
    montandoMsg = true;
    const sec = document.createElement('details');
    sec.id = 'mod-mensagens';
    sec.className = 'blk';
    sec.innerHTML = `<summary>Moderação · mensagens do contato <span class="mod-badge" hidden></span></summary>
      <p class="hint">E-mails enviados para contato@entrelinhasbr.com.br. Ao responder, avise na conversa da moderação para ninguém responder duas vezes.</p>
      <label class="mod-todas"><input type="checkbox" id="mod-msg-todas"> Mostrar também as arquivadas</label>
      <div id="mod-msg-lista"><p class="hint">Carregando...</p></div>`;
    ref.after(sec);
    montandoMsg = false;
    const lista = sec.querySelector('#mod-msg-lista'), badge = sec.querySelector('.mod-badge'), todas = sec.querySelector('#mod-msg-todas');
    const quando = (t) => new Date(t * 1000).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
    const recarregar = async () => {
      let ms = [];
      try { ms = await api('/api/admin/mensagens' + (todas.checked ? '?todas=1' : '')); } catch (e) { lista.innerHTML = `<p class="note err">${esc(e.message)}</p>`; return; }
      const novas = ms.filter((m) => m.status === 'nova').length;
      badge.hidden = !novas; badge.textContent = novas;
      if (!ms.length) { lista.innerHTML = '<p class="hint">Nenhuma mensagem.</p>'; return; }
      lista.innerHTML = ms.map((m) => {
        const para = m.responder_para || m.remetente;
        const responder = `mailto:${encodeURIComponent(para)}?subject=${encodeURIComponent('Re: ' + (m.assunto || 'sua mensagem ao Entrelinhas'))}`;
        const botao = (status, rotulo) => `<button type="button" class="btn btn-ghost" data-status="${status}">${rotulo}</button>`;
        return `<div class="mod-den mod-msg${m.status === 'nova' ? ' nova' : ''}" data-id="${m.id}">
          <p><b>${esc(m.assunto || '(sem assunto)')}</b></p>
          <p class="hint">${esc(m.nome ? m.nome + ' · ' : '')}${esc(m.remetente)} · ${quando(m.recebida_em)}${m.status !== 'nova' ? ` · ${esc(m.status)}${m.lida_por ? ' por ' + esc(m.lida_por) : ''}` : ''}</p>
          <p class="mod-den-txt mod-msg-txt">${esc(m.texto || '(sem texto)')}</p>
          ${m.anexos.length ? `<p class="hint">Anexos (veja na caixa do Proton): ${m.anexos.map(esc).join(', ')}</p>` : ''}
          <div class="mod-den-acoes"><a class="btn btn-primary" href="${esc(responder)}">Responder</a>
            ${m.status === 'nova' ? botao('lida', 'Marcar como lida') : botao('nova', 'Marcar como nova')}
            ${m.status !== 'arquivada' ? botao('arquivada', 'Arquivar') : ''}</div>
        </div>`;
      }).join('');
    };
    todas.addEventListener('change', recarregar);
    lista.addEventListener('click', async (e) => {
      const b = e.target.closest('button[data-status]'); if (!b) return;
      b.disabled = true;
      try {
        await api('/api/admin/mensagens/' + b.closest('.mod-den').dataset.id, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: b.dataset.status }) });
        recarregar();
      } catch (err) { b.disabled = false; b.insertAdjacentHTML('afterend', `<p class="note err">${esc(err.message)}</p>`); }
    });
    recarregar();
  }

  // ---------- conteudo da pagina inicial (noticias, projetos, selos, servicos, contato) ----------
  // Os formularios saem do esquema que o servidor manda (src/site.js): campo novo no servidor aparece aqui sozinho.
  let montandoSite = false;
  const novo = (tag, props = {}, ...filhos) => { const e = Object.assign(document.createElement(tag), props); e.append(...filhos); return e; };

  async function montarSite() {
    const den = document.getElementById('mod-denuncias');
    if (montandoSite || document.getElementById('mod-site') || !den) return;
    montandoSite = true;
    const sec = novo('details', { id: 'mod-site', className: 'blk' },
      novo('summary', {}, 'Moderação · conteúdo da página inicial'),
      novo('p', { className: 'hint' }, 'Notícias, projetos em andamento, selos, serviços e contato da página inicial. Cada seção é salva separadamente e muda no site na hora.'));
    (document.getElementById('mod-mensagens') || document.getElementById('mod-feedback') || document.getElementById('mod-den-av') || den).after(sec);
    montandoSite = false;
    const corpo = novo('div', {}, novo('p', { className: 'hint' }, 'Carregando...'));
    sec.append(corpo);
    let S;
    try { S = await api('/api/admin/site'); } catch (e) { corpo.replaceChildren(novo('p', { className: 'note err' }, e.message)); return; }
    corpo.replaceChildren(...Object.entries(S.secoes).map(([chave, esq]) => secaoEditor(chave, esq, S.dados[chave])));
  }

  function campoEditor(c, valor, aoMudar) {
    let el;
    if (c.tipo === 'area') el = novo('textarea', { rows: 3, maxLength: c.max, value: valor || '' });
    else if (c.tipo === 'escolha') { el = novo('select', {}, ...c.opcoes.map((o) => novo('option', { value: o, textContent: o }))); el.value = c.opcoes.includes(valor) ? valor : c.opcoes[0]; }
    else if (c.tipo === 'numero') el = novo('input', { type: 'number', min: c.min, max: c.max, value: valor == null ? '' : valor });
    else if (c.tipo === 'cor') el = novo('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(valor || '') ? valor : '#1c2f4a' });
    else el = novo('input', { type: 'text', maxLength: c.max, value: valor || '' });
    if (c.obrig) el.required = true;
    const ler = () => aoMudar(c.tipo === 'numero' ? Number(el.value) : el.value);
    el.addEventListener('input', ler); el.addEventListener('change', ler);
    if (c.tipo === 'escolha' || c.tipo === 'cor') ler(); // valor padrao entra no item
    return novo('label', { className: 'fld' }, novo('span', {}, c.rotulo + (c.obrig ? ' *' : '')), el);
  }

  function secaoEditor(chave, esq, dadosIniciais) {
    let itens = esq.unico ? [Object.assign({}, dadosIniciais)] : (dadosIniciais || []).map((x) => Object.assign({}, x));
    const caixa = novo('fieldset', { className: 'blk mod-site-sec' }, novo('legend', {}, esq.rotulo));
    const lista = novo('div', { className: 'mod-site-lista' });
    const estado = novo('div', { className: 'el-estado', role: 'status' });
    const avisar = (t, ok) => estado.replaceChildren(novo('p', { className: 'note ' + (ok ? 'ok' : 'err') }, t));
    const desenhar = () => {
      lista.replaceChildren(...itens.map((it, i) => {
        const box = novo('div', { className: 'item mod-site-item' });
        if (!esq.unico) {
          const mover = (d) => { const j = i + d; if (j < 0 || j >= itens.length) return; [itens[i], itens[j]] = [itens[j], itens[i]]; desenhar(); };
          box.append(novo('div', { className: 'mod-site-acoes' },
            novo('b', {}, `${esq.item} ${i + 1}`),
            Object.assign(novo('button', { type: 'button', className: 'rm', title: 'Subir', textContent: '↑' }), { onclick: () => mover(-1) }),
            Object.assign(novo('button', { type: 'button', className: 'rm', title: 'Descer', textContent: '↓' }), { onclick: () => mover(1) }),
            Object.assign(novo('button', { type: 'button', className: 'rm', textContent: 'Remover' }), { onclick: () => { itens.splice(i, 1); desenhar(); } })));
        }
        for (const c of esq.campos) box.append(campoEditor(c, it[c.k], (v) => { it[c.k] = v; }));
        return box;
      }));
      if (adicionar) adicionar.hidden = itens.length >= esq.max;
    };
    const adicionar = esq.unico ? null : Object.assign(novo('button', { type: 'button', className: 'btn btn-ghost', textContent: 'Adicionar ' + esq.item }), {
      onclick: () => { itens.push({}); desenhar(); lista.lastElementChild.querySelector('input,textarea').focus(); },
    });
    const salvar = Object.assign(novo('button', { type: 'button', className: 'btn btn-primary', textContent: 'Salvar ' + esq.rotulo.toLowerCase() }), {
      onclick: async () => {
        salvar.disabled = true;
        try {
          const r = await api('/api/admin/site/' + chave, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dados: esq.unico ? itens[0] : itens }) });
          itens = esq.unico ? [r.dados] : r.dados; desenhar(); avisar('Salvo. Já está na página inicial.', true);
        } catch (err) { avisar(err.message); }
        salvar.disabled = false;
      },
    });
    caixa.append(lista, novo('div', { className: 'mod-site-rodape' }, ...(adicionar ? [adicionar] : []), salvar), estado);
    desenhar();
    return caixa;
  }

  new MutationObserver(() => { montar(); montarConvites(); montarDenuncias(); montarDenunciasAvaliacoes(); montarFeedback(); montarMensagens(); montarSite(); }).observe(app, { childList: true });
  // o painel de senha monta de forma assincrona; quando ele entra em #app, o observador monta o de convites
  montar();
})();
