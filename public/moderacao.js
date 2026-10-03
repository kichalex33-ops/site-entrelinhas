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
    if (carregando || document.getElementById('mod-panel') || !app.querySelector('#ed')) return;
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

  new MutationObserver(() => { montar(); montarConvites(); }).observe(app, { childList: true });
  // o painel de senha monta de forma assincrona; quando ele entra em #app, o observador monta o de convites
  montar();
})();
