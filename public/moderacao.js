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

  new MutationObserver(montar).observe(app, { childList: true });
  montar();
})();
