// Utilidades compartilhadas pelas paginas de autor.
(function(){
  'use strict';
  const ENT = {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'};
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ENT[c]);
  const imgUrl = (id) => !id ? '' : id.charAt(0) === '/' ? id : '/img/' + id + '?v=2'; // v=2: ignora copias vazias antigas em cache
  const paras = (t) => String(t || '').split(/\n{2,}|\r\n\r\n/).map(s => s.trim()).filter(Boolean)
    .map(p => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
  const isExternal = (u) => /^https?:/i.test(u);
  const linkAttrs = (u) => isExternal(u) ? ' target="_blank" rel="noopener noreferrer"' : '';
  const TINTS = { preto: '#17171c', azul: '#112442', vinho: '#3a1322', verde: '#0f2f26', grafite: '#2a2a30' };
  const hexOk = (c) => /^#[0-9a-f]{6}$/i.test(c || '') ? c : '#d9a94a';
  const hexRgba = (c, a) => { const n = parseInt(hexOk(c).slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };

  function theme(el, d){
    const cor = hexOk(d.cor);
    el.style.setProperty('--accent', cor);
    el.style.setProperty('--accent-dim', hexRgba(cor, .14));
    el.style.background = `radial-gradient(900px 420px at 50% 0, ${TINTS[d.fundo] || TINTS.preto}, transparent 70%)`;
  }
  function initial(nome){ return esc((nome || '?').trim().charAt(0).toUpperCase()); }

  async function api(path, opts){
    const o = Object.assign({ headers: {} }, opts || {});
    if (o.method && o.method !== 'GET') o.headers['X-Requested-With'] = 'fetch';
    const r = await fetch(path, o);
    let data = null;
    try { data = await r.json(); } catch (e) {}
    if (!r.ok) { const err = new Error((data && data.erro) || 'Falha na requisição.'); err.status = r.status; err.data = data; throw err; }
    return data;
  }

  window.EL = { esc, imgUrl, paras, linkAttrs, theme, initial, api };
})();
