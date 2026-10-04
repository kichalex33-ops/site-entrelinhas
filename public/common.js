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

  // cor e fundo escolhidos pelo autor; o CSS (.tinta-autor em extra.css) adapta ao modo claro/escuro
  function theme(el, d){
    el.classList.add('tinta-autor');
    el.style.setProperty('--cor-autor', hexOk(d.cor));
    el.style.setProperty('--tinta', TINTS[d.fundo] || TINTS.preto);
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

  // classificacao indicativa (mesma lista de src/studio.js: FAIXAS)
  const FAIXAS = [['L', 'Livre para todos os públicos'], ['10', 'Não recomendado para menores de 10 anos'], ['12', 'Não recomendado para menores de 12 anos'],
    ['14', 'Não recomendado para menores de 14 anos'], ['16', 'Não recomendado para menores de 16 anos'], ['18', 'Não recomendado para menores de 18 anos']];
  const faixa = (f) => { const x = FAIXAS.find((i) => i[0] === f); return x ? `<span class="faixa faixa-${x[0]}" title="${esc(x[1])}" aria-label="${esc(x[1])}">${x[0]}</span>` : ''; };
  // "2025" -> "2025"; "2025-03" -> "mar. 2025"
  const mesAno = (s) => { const m = /^(\d{4})(?:-(\d{2}))?$/.exec(s || ''); if (!m) return ''; return m[2] ? new Date(+m[1], +m[2] - 1, 1).toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' }) : m[1]; };

  // reduz a imagem no navegador (JPEG ate ~550 KB) e envia; devolve o id da imagem
  async function enviarImagem(file) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('Envie uma imagem JPEG, PNG ou WebP.');
    const bmp = await createImageBitmap(file);
    let max = 1400, blob = null;
    for (let i = 0; i < 7 && !blob; i++) {
      const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas'); c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      const b = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.85));
      if (b && b.size <= 550 * 1024) blob = b; else max = Math.round(max * 0.8);
    }
    if (!blob) throw new Error('Não foi possível reduzir a imagem. Tente uma menor.');
    const r = await api('/api/image', { method: 'POST', headers: { 'Content-Type': blob.type }, body: blob });
    return r.id;
  }

  // abre o recorte (Cropper.js, public/vendor/recorte.js) e devolve o JPEG enquadrado, ou null se a pessoa cancelar
  const recortar = (file, opcoes) => import('/vendor/recorte.js').then((m) => m.recortar(file, opcoes));

  window.EL = { esc, imgUrl, paras, linkAttrs, theme, initial, api, FAIXAS, faixa, mesAno, enviarImagem, recortar };
})();
