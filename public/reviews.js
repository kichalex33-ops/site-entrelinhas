// Avaliacoes de uma obra: lista, formulario, util, denuncia e exclusao.
// Uso: EL.reviews.mount(elemento, { autor: 'slug-do-autor', obra: 'id-da-obra' })
(function(){
  'use strict';
  const { esc, api } = EL;
  const stars = (n) => { const r = Math.round(n); return '★'.repeat(r) + '☆'.repeat(5 - r); };
  const dia = (s) => new Date(s * 1000).toLocaleDateString('pt-BR');
  const txt = (t) => esc(t).replace(/\n/g, '<br>');
  const MOTIVOS = [['spoiler', 'Spoiler sem aviso'], ['ofensivo', 'Ofensivo'], ['spam', 'Spam']];
  const J = { 'Content-Type': 'application/json' };

  async function mount(box, ctx){
    box.innerHTML = '<p class="muted-note">Carregando avaliações...</p>';
    let d;
    try { d = await api('/api/reviews?autor=' + encodeURIComponent(ctx.autor) + '&obra=' + encodeURIComponent(ctx.obra)); }
    catch (e) { box.innerHTML = '<p class="muted-note">Não foi possível carregar as avaliações.</p>'; return; }
    const reload = () => mount(box, ctx);
    const mine = d.reviews.find(r => r.minha);

    const item = (r) => `
      <article class="rev-item" data-id="${r.id}">
        <div class="rev-head">
          <b>${r.perfil ? `<a href="autor.html?a=${encodeURIComponent(r.perfil)}">${esc(r.nome)}</a>` : esc(r.nome)}</b>
          <span class="stars" aria-label="Nota ${r.nota} de 5">${stars(r.nota)}</span>
          <span class="rev-date">${esc(dia(r.em))}</span>
        </div>
        ${r.spoiler ? `<details class="rev-spoiler"><summary>Esta avaliação contém spoiler. Clique para ler.</summary><p>${txt(r.texto)}</p></details>` : `<p>${txt(r.texto)}</p>`}
        <div class="rev-actions">
          <button type="button" class="rev-btn${r.meu_voto ? ' on' : ''}" data-util="${r.id}"${r.minha ? ' disabled' : ''}>Útil (${r.uteis})</button>
          ${!r.minha && d.eu ? `<details class="rev-report"><summary>Denunciar</summary>${MOTIVOS.map(([k, t]) => `<button type="button" class="rev-btn" data-rep="${r.id}:${k}">${t}</button>`).join('')}</details>` : ''}
          ${r.minha || (d.eu && d.eu.mod) ? `<button type="button" class="rev-btn danger" data-del="${r.id}">Apagar</button>` : ''}
          ${d.eu && d.eu.mod && r.denuncias ? `<span class="rev-flag">${r.denuncias} denúncia(s)</span>` : ''}
        </div>
      </article>`;

    let form;
    if (!d.eu) form = '<p class="rev-login">Para avaliar, <a href="conta.html">entre ou crie uma conta de leitor</a>.</p>';
    else if (d.eu.dono) form = '<p class="rev-login">Você não pode avaliar a sua própria obra.</p>';
    else form = `
      <form class="rev-form" autocomplete="off">
        <h4>${mine ? 'Atualizar a sua avaliação' : 'Deixe a sua avaliação'}</h4>
        <label class="fld"><span>Nota</span>
          <select name="nota" required>${[5, 4, 3, 2, 1].map(n => `<option value="${n}"${(mine ? mine.nota : 5) === n ? ' selected' : ''}>${stars(n)} (${n})</option>`).join('')}</select></label>
        <label class="fld"><span>Sua avaliação (mínimo 10 caracteres)</span>
          <textarea name="texto" rows="4" maxlength="3000" required>${mine ? esc(mine.texto) : ''}</textarea></label>
        <label class="chk"><input type="checkbox" name="spoiler"${mine && mine.spoiler ? ' checked' : ''}> Contém spoiler</label>
        <button class="btn btn-primary" type="submit">${mine ? 'Atualizar avaliação' : 'Publicar avaliação'}</button>
        <span class="rev-note" role="status"></span>
      </form>`;

    box.innerHTML = `
      <div class="rev-sum">${d.resumo.total ? `<span class="stars">${stars(d.resumo.media)}</span> <b>${d.resumo.media.toFixed(1)}</b> de 5 · ${d.resumo.total} avaliaç${d.resumo.total === 1 ? 'ão' : 'ões'}` : 'Ainda não há avaliações.'}</div>
      ${form}
      <div class="rev-list">${d.reviews.map(item).join('')}</div>`;

    const f = box.querySelector('.rev-form');
    if (f) f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const note = f.querySelector('.rev-note'), btn = f.querySelector('button[type=submit]');
      btn.disabled = true; note.textContent = '';
      try {
        await api('/api/reviews', { method: 'PUT', headers: J, body: JSON.stringify({
          autor: ctx.autor, obra: ctx.obra, nota: Number(f.nota.value), texto: f.texto.value, spoiler: f.spoiler.checked }) });
        await reload();
      } catch (err) { note.textContent = err.message; btn.disabled = false; }
    });

    // um unico listener por caixa; ele le o estado mais recente guardado em box._rev
    box._rev = { d, reload };
    if (box._revBound) return;
    box._revBound = true;
    box.addEventListener('click', async (e) => {
      const t = e.target; if (!(t instanceof HTMLElement)) return;
      const { d, reload } = box._rev;
      try {
        if (t.dataset.util) {
          if (!d.eu) return alert('Entre na sua conta para marcar como útil.');
          await api('/api/reviews/' + t.dataset.util + '/util', { method: 'POST' }); reload();
        } else if (t.dataset.rep) {
          const [id, motivo] = t.dataset.rep.split(':');
          await api('/api/reviews/' + id + '/denunciar', { method: 'POST', headers: J, body: JSON.stringify({ motivo }) });
          t.closest('details').outerHTML = '<span class="rev-flag">Denúncia enviada. Obrigado.</span>';
        } else if (t.dataset.del) {
          if (!confirm('Apagar esta avaliação?')) return;
          await api('/api/reviews/' + t.dataset.del, { method: 'DELETE' }); reload();
        }
      } catch (err) { alert(err.message); }
    });
  }

  EL.reviews = { mount };
})();
