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
      <p class="hint">Plágio, pirataria, IA sem aviso, classificação errada... Analise, fale com o autor se preciso e registre a decisão. O autor vê os motivos em análise, nunca quem denunciou.</p>
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
        return `<div class="mod-den-grupo"><p><a href="obra.html?a=${encodeURIComponent(a)}&o=${encodeURIComponent(o)}" target="_blank" rel="noopener"><b>Ver o livro</b></a> <span class="hint">de ${esc(a)} · ${itens.length} denúncia(s)</span></p>
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

  new MutationObserver(() => { montar(); montarConvites(); montarDenuncias(); }).observe(app, { childList: true });
  // o painel de senha monta de forma assincrona; quando ele entra em #app, o observador monta o de convites
  montar();
})();
