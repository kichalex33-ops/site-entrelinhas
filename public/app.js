(function(){
  'use strict';
  const $ = (s) => document.querySelector(s);
  const ENT = {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'};
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ENT[c]);
  const lines = (t) => esc(t).replace(/ /g, '<br>');
  const dateKey = (s) => s.split('/').reverse().join('');
  let DATA, authors;

  const ext = (u) => /^https?:/.test(u) ? ' target="_blank" rel="noopener"' : '';
  const author = (id) => authors[id] || { nome: id, link: '' };
  const byline = (id) => {
    const a = author(id);
    return a.link ? `<a href="${esc(a.link)}"${ext(a.link)}>${esc(a.nome)}</a>` : `<b>${esc(a.nome)}</b>`;
  };
  const cover = (b) => b.capa ? `<div class="cover cover-img"><img src="${esc(b.capa)}" alt="Capa de ${esc(b.titulo)}" loading="lazy"></div>` : `<div class="cover" style="--c1:${esc(b.c1)};--c2:${esc(b.c2)}"><span class="cover-title">${lines(b.titulo)}</span><span class="cover-author">${esc(author(b.autor).nome)}</span></div>`;
  const bookAttrs = (b) => `data-id="${esc(b.titulo)}"`;

  function render(){
    const livros = DATA.livros.slice().sort((a, b) => a.titulo.localeCompare(b.titulo, 'pt'));

    $('#featured').innerHTML = livros.filter(b => b.destaque).map(b =>
      `<figure class="slide" ${bookAttrs(b)}>${cover(b)}<figcaption>${esc(b.genero)}${b.ano ? ' · ' + esc(b.ano) : ''}</figcaption></figure>`).join('');

    $('#news').innerHTML = DATA.noticias.slice().sort((a, b) => dateKey(b.data).localeCompare(dateKey(a.data))).map(n =>
      `<article class="post reveal"><span class="date">${esc(n.data)}</span><h4>${esc(n.titulo)}</h4><p>${esc(n.texto)}</p><p class="byline">por ${byline(n.autor)}</p></article>`).join('');

    $('#selos').innerHTML = DATA.selos.map(s =>
      `<div class="selo reveal"><h4>${esc(s.nome)}</h4><p>${esc(s.texto)}</p></div>`).join('');

    const generos = ['Todos'].concat([...new Set(livros.map(b => b.genero))].sort((a, b) => a.localeCompare(b, 'pt')));
    $('#chips').innerHTML = generos.map((g, i) =>
      `<button class="chip${i ? '' : ' active'}" data-filter="${i ? esc(g) : 'all'}">${esc(g)}</button>`).join('');

    $('#libraryGrid').innerHTML = livros.map(b =>
      `<article class="book-card reveal in" data-genre="${esc(b.genero)}" ${bookAttrs(b)}>${cover(b)}<div class="meta"><h4>${esc(b.titulo)}</h4><p class="author">${esc(author(b.autor).nome)}</p><span class="tag">${esc(b.genero)}</span></div></article>`).join('');

    $('#releases').innerHTML = DATA.livros.filter(b => b.lancamento).map(b =>
      `<article class="rel-card">${cover(b)}<span class="badge-new">Novo</span><h3>${esc(b.titulo)}</h3><p class="by">${esc(author(b.autor).nome)} · ${esc(b.genero)}</p><p class="when">${esc(b.lancamento)}</p><button class="btn btn-ghost" data-open ${bookAttrs(b)}>Ler sinopse</button></article>`).join('');

    $('#projects').innerHTML = DATA.projetos.map(p =>
      `<article class="project reveal"><div class="project-visual" style="--c1:${esc(p.c1)};--c2:${esc(p.c2)}"><span class="project-status">${esc(p.etapa)} · ${esc(p.pct)}%</span></div><div class="project-body"><h3>${esc(p.titulo)}</h3><p class="by">${esc(author(p.autor).nome)} · ${esc(p.genero)}</p><p>${esc(p.sinopse)}</p>${p.trecho ? `<blockquote class="excerpt">${esc(p.trecho)}</blockquote>` : ''}<div class="progress"><span style="width:${Number(p.pct) || 0}%"></span></div><div class="progress-label"><span>${esc(p.pct)}% concluído</span><span>Previsão: ${esc(p.previsao)}</span></div></div></article>`).join('');

    $('#services').innerHTML = DATA.servicos.map(s =>
      `<div class="service reveal"><div class="icon">${esc(s.icone)}</div><span class="status${s.status === 'Aberto' ? ' on' : ''}">${esc(s.status)}</span><h3>${esc(s.titulo)}</h3><p>${esc(s.texto)}</p></div>`).join('');

    $('#contact').innerHTML = DATA.contato
      ? `Contato: <a href="${esc(DATA.contato)}" target="_blank" rel="noopener">${esc(DATA.contato)}</a>`
      : 'Canal de contato em definição pelo coletivo.';
  }

  function bind(){
    const tabs = [...document.querySelectorAll('.tab[data-target]')], pages = [...document.querySelectorAll('.page')];
    const io = new IntersectionObserver((es) => es.forEach(e => {
      if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    }), { threshold: .08 });
    const watch = () => document.querySelectorAll('.page.active .reveal:not(.in)').forEach(el => io.observe(el));

    const goTo = (id, scroll) => {
      if (!document.getElementById(id)) return;
      tabs.forEach(t => t.classList.toggle('active', t.dataset.target === id));
      pages.forEach(p => p.classList.toggle('active', p.id === id));
      watch();
      if (scroll !== false) window.scrollTo({ top: 0, behavior: 'smooth' });
      history.replaceState(null, '', '#' + id);
    };
    tabs.forEach(t => t.addEventListener('click', () => goTo(t.dataset.target)));
    document.querySelectorAll('[data-goto]').forEach(el => el.addEventListener('click', e => { e.preventDefault(); goTo(el.dataset.goto); }));
    const h = location.hash.slice(1);
    if (h && document.getElementById(h)) goTo(h, false); else watch();

    const track = $('.marquee-track');
    if (track.children.length) {
      const c = track.children[0].cloneNode(true);
      c.setAttribute('aria-hidden', 'true');
      track.appendChild(c);
    }

    const car = $('#releases');
    const step = () => { const c = car.querySelector('.rel-card'); return c ? c.offsetWidth + 24 : 300; };
    $('#carPrev').addEventListener('click', () => car.scrollBy({ left: -step() }));
    $('#carNext').addEventListener('click', () => car.scrollBy({ left: step() }));

    const modal = $('#modal');
    const open = (title) => {
      const b = DATA.livros.find(x => x.titulo === title);
      if (!b) return;
      const a = author(b.autor);
      const mc = $('#modalCover');
      mc.style.setProperty('--c1', b.c1 || '#222');
      mc.style.setProperty('--c2', b.c2 || '#0a0a0a');
      mc.classList.toggle('cover-img', !!b.capa);
      mc.innerHTML = b.capa
        ? `<img src="${esc(b.capa)}" alt="Capa de ${esc(b.titulo)}">`
        : `<span class="cover-title">${lines(b.titulo)}</span><span class="cover-author">${esc(a.nome)}</span>`;
      $('#modalBuy').innerHTML = (b.compra || []).map((c, i) =>
        `<a class="btn ${i ? 'btn-ghost' : 'btn-primary'}" href="${esc(c.url)}" target="_blank" rel="noopener noreferrer sponsored">${esc(c.rotulo)}</a>`).join('');
      $('#modalGenre').textContent = b.genero;
      $('#modalTitle').textContent = b.titulo;
      $('#modalAuthor').textContent = a.nome;
      $('#modalSynopsis').textContent = b.sinopse || 'Sinopse em breve.';
      const l = $('#modalLink');
      l.hidden = !a.link;
      if (a.link) { l.href = a.link; if (/^https?:/.test(a.link)) { l.target = '_blank'; l.rel = 'noopener'; } else { l.removeAttribute('target'); } }
      modal.classList.add('open');
      modal.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
    };
    const close = () => {
      modal.classList.remove('open');
      modal.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
    };
    document.addEventListener('click', e => {
      const el = e.target.closest('.slide, .book-card, [data-open]');
      if (el) { e.preventDefault(); open(el.dataset.id); }
    });
    modal.addEventListener('click', e => { if (e.target.hasAttribute('data-close')) close(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && modal.classList.contains('open')) close(); });

    const chips = document.querySelectorAll('.chip'), cards = document.querySelectorAll('#libraryGrid .book-card');
    chips.forEach(c => c.addEventListener('click', () => {
      chips.forEach(x => x.classList.remove('active'));
      c.classList.add('active');
      cards.forEach(k => { k.style.display = (c.dataset.filter === 'all' || k.dataset.genre === c.dataset.filter) ? '' : 'none'; });
    }));
  }

  fetch('data.json').then(r => r.json()).then(d => {
    DATA = d; authors = d.autores; render(); bind();
  }).catch(() => {
    $('main').insertAdjacentHTML('afterbegin', '<p style="padding:3rem;text-align:center;color:#8c8c95">Não foi possível carregar o conteúdo.</p>');
  });
})();
