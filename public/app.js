(function(){
  'use strict';
  const $ = (s) => document.querySelector(s);
  const ENT = {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'};
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ENT[c]);
  const lines = (t) => esc(t).replace(/ /g, '<br>');
  const dateKey = (s) => s.split('/').reverse().join('');
  let DATA, authors, LIVROS = [];

  const ext = (u) => /^https?:/.test(u) ? ' target="_blank" rel="noopener"' : '';
  const author = (id) => authors[id] || { nome: id, link: '' };
  const byline = (id) => {
    const a = author(id);
    return a.link ? `<a href="${esc(a.link)}"${ext(a.link)}>${esc(a.nome)}</a>` : `<b>${esc(a.nome)}</b>`;
  };
  const FAIXA_TXT = { L: 'Livre para todos os públicos' };
  const faixa = (f) => /^(L|10|12|14|16|18)$/.test(f || '') ? `<span class="faixa faixa-${f}" title="${esc(FAIXA_TXT[f] || 'Não recomendado para menores de ' + f + ' anos')}">${f}</span>` : '';
  const dia = (t) => new Date(t * 1000).toLocaleDateString('pt-BR');
  const mesAno = (s) => { const m = /^(\d{4})(?:-(\d{2}))?$/.exec(s || ''); return !m ? '' : m[2] ? new Date(+m[1], +m[2] - 1, 1).toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' }) : m[1]; };
  const primeiroGenero = (g) => (String(g || '').split(/\s*[·,/]\s*/)[0] || 'Outros').trim();

  // livros vindos do banco (/api/vitrine) -> modelo unico da vitrine
  const doBanco = (l) => ({
    titulo: l.titulo, autorNome: l.autor.nome, genero: l.genero, gen1: primeiroGenero(l.genero), capa: l.capa,
    c1: '#1c2f4a', c2: '#070b14', href: `obra.html?a=${encodeURIComponent(l.autor.slug)}&o=${encodeURIComponent(l.id)}`,
    faixa: l.faixa, data: l.no_site_em || 0, lancamento: l.lancamento, ler: l.ler || '', aval: l.avaliacoes, pop: l.popular,
  });
  // reserva: o arquivo antigo (so usado se a API falhar)
  const doArquivo = (b) => ({
    titulo: b.titulo, autorNome: author(b.autor).nome, genero: b.genero, gen1: b.genero, capa: b.capa, c1: b.c1, c2: b.c2,
    href: '', json: b, faixa: '', data: 0, lancamento: '', ler: '',
  });

  const cover = (b) => b.capa ? `<div class="cover cover-img"><img src="${esc(b.capa)}" alt="Capa de ${esc(b.titulo)}" loading="lazy"></div>` : `<div class="cover" style="--c1:${esc(b.c1)};--c2:${esc(b.c2)}"><span class="cover-title">${lines(b.titulo)}</span><span class="cover-author">${esc(b.autorNome)}</span></div>`;
  const bookAttrs = (b) => b.href ? `data-href="${esc(b.href)}"` : `data-id="${esc(b.titulo)}"`;
  const quando = (b) => b.data ? `No Entrelinhas desde ${dia(b.data)}` : b.json && b.json.lancamento ? b.json.lancamento : '';
  const novo = (b) => b.data && Date.now() / 1000 - b.data < 30 * 86400;
  const relCard = (b) => `<article class="rel-card">${b.href ? `<a class="cover-link" href="${esc(b.href)}" aria-label="${esc(b.titulo)}">${cover(b)}</a>` : cover(b)}${novo(b) ? '<span class="badge-new">Novo</span>' : ''}<h3>${esc(b.titulo)} ${faixa(b.faixa)}</h3><p class="by">${esc(b.autorNome)}${b.genero ? ' · ' + esc(b.genero) : ''}</p><p class="when">${esc(quando(b))}</p>${b.href ? `<a class="btn btn-ghost" href="${esc(b.href)}">Ver o livro</a>` : `<button class="btn btn-ghost" data-open ${bookAttrs(b)}>Ler sinopse</button>`}</article>`;

  // popularidade (calculada no servidor: visitas unicas + favoritos + avaliacoes do periodo)
  const pop = (b, p) => (b.pop && b.pop[p]) || 0;
  const QUANDO = { semana: 'nesta semana', mes: 'neste mês', ano: 'neste ano' };
  let periodo = 'semana', ordem = 'az';

  function desenharPopulares(){
    const lista = LIVROS.filter((b) => pop(b, periodo) > 0).sort((a, b) => pop(b, periodo) - pop(a, periodo)).slice(0, 12);
    $('#populares').innerHTML = lista.map(relCard).join('') || `<p class="muted-note">Ainda não há leituras ${QUANDO[periodo]}.</p>`;
  }

  // Biblioteca: ordem escolhida + filtro de genero (o filtro vale de novo depois de reordenar)
  function desenharGrade(){
    const az = (a, b) => a.titulo.localeCompare(b.titulo, 'pt');
    const p = ordem.startsWith('pop-') ? ordem.slice(4) : '';
    const livros = LIVROS.slice().sort(p ? (a, b) => pop(b, p) - pop(a, p) || az(a, b) : ordem === 'recentes' ? (a, b) => b.data - a.data || az(a, b) : az);
    $('#libraryGrid').innerHTML = livros.map(b =>
      `<article class="book-card reveal in" data-genre="${esc(b.gen1)}" data-i="${b.i}" ${bookAttrs(b)}>${cover(b)}<div class="meta"><h4>${esc(b.titulo)} ${faixa(b.faixa)}</h4><p class="author">${esc(b.autorNome)}</p><span class="tag">${esc(b.genero || b.gen1)}</span>${b.ler ? '<span class="tag tag-ler">Ler no site</span>' : ''}</div></article>`).join('')
      || '<p class="muted-note">Nenhum livro publicado ainda.</p>';
    filtrar();
  }
  // busca por titulo, autor ou genero (MiniSearch, public/vendor/busca.js): carrega na primeira tecla
  let buscar = null, achados = null;
  async function aoBuscar(texto){
    if (!buscar) {
      try { const m = await import('/vendor/busca.js'); buscar = m.criarBusca(LIVROS.map((b) => ({ id: b.i, titulo: b.titulo, autorNome: b.autorNome, genero: b.genero }))); }
      catch { buscar = (t) => { const q = t.trim().toLowerCase(); return q ? new Set(LIVROS.filter((b) => (b.titulo + ' ' + b.autorNome + ' ' + b.genero).toLowerCase().includes(q)).map((b) => b.i)) : null; }; }
    }
    achados = buscar(texto); filtrar();
  }
  function filtrar(){
    const c = document.querySelector('#chips .chip.active'), f = c ? c.dataset.filter : 'all';
    let n = 0;
    document.querySelectorAll('#libraryGrid .book-card').forEach((k) => {
      const ver = (f === 'all' || k.dataset.genre === f) && (!achados || achados.has(Number(k.dataset.i)));
      k.style.display = ver ? '' : 'none'; if (ver) n++;
    });
    const aviso = $('#buscaVazia');
    if (aviso) aviso.hidden = n > 0 || !LIVROS.length;
  }

  function render(){
    const livros = LIVROS.slice().sort((a, b) => a.titulo.localeCompare(b.titulo, 'pt'));
    const recentes = LIVROS.slice().sort((a, b) => b.data - a.data);

    // destaques: com capa primeiro, os mais recentes
    const destaques = (LIVROS.some((b) => b.json) ? livros.filter((b) => b.json.destaque) : recentes.filter((b) => b.capa).concat(recentes.filter((b) => !b.capa))).slice(0, 14);
    $('#featured').innerHTML = destaques.map(b =>
      `<figure class="slide" ${bookAttrs(b)}>${cover(b)}<figcaption>${esc(b.genero)}${b.lancamento ? ' · ' + esc(mesAno(b.lancamento)) : ''}</figcaption></figure>`).join('');

    $('#recentes').innerHTML = recentes.slice(0, 12).map(relCard).join('') || '<p class="muted-note">Os livros publicados aparecem aqui.</p>';
    $('#releases').innerHTML = recentes.slice(0, 24).map(relCard).join('');

    $('#news').innerHTML = DATA.noticias.slice().sort((a, b) => dateKey(b.data).localeCompare(dateKey(a.data))).map(n =>
      `<article class="post reveal"><span class="date">${esc(n.data)}</span><h4>${esc(n.titulo)}</h4><p>${esc(n.texto)}</p><p class="byline">por ${byline(n.autor)}</p></article>`).join('');

    $('#selos').innerHTML = DATA.selos.map(s =>
      `<div class="selo reveal"><h4>${esc(s.nome)}</h4><p>${esc(s.texto)}</p></div>`).join('');

    const generos = ['Todos'].concat([...new Set(livros.map(b => b.gen1))].sort((a, b) => a.localeCompare(b, 'pt')));
    $('#chips').innerHTML = generos.map((g, i) =>
      `<button class="chip${i ? '' : ' active'}" data-filter="${i ? esc(g) : 'all'}">${esc(g)}</button>`).join('');

    desenharGrade();
    desenharPopulares();

    $('#projects').innerHTML = DATA.projetos.map(p =>
      `<article class="project reveal"><div class="project-visual" style="--c1:${esc(p.c1)};--c2:${esc(p.c2)}"><span class="project-status">${esc(p.etapa)} · ${esc(p.pct)}%</span></div><div class="project-body"><h3>${esc(p.titulo)}</h3><p class="by">${esc(author(p.autor).nome)} · ${esc(p.genero)}</p><p>${esc(p.sinopse)}</p>${p.trecho ? `<blockquote class="excerpt">${esc(p.trecho)}</blockquote>` : ''}<div class="progress"><span style="width:${Number(p.pct) || 0}%"></span></div><div class="progress-label"><span>${esc(p.pct)}% concluído</span><span>Previsão: ${esc(p.previsao)}</span></div></div></article>`).join('');

    $('#services').innerHTML = DATA.servicos.map(s =>
      `<div class="service reveal"><div class="icon">${esc(s.icone)}</div><span class="status${s.status === 'Aberto' ? ' on' : ''}">${esc(s.status)}</span><h3>${esc(s.titulo)}</h3><p>${esc(s.texto)}</p>${s.link ? `<a class="btn btn-ghost service-link" href="${esc(s.link)}">${esc(s.acao || 'Saiba mais')} &rarr;</a>` : ''}</div>`).join('');

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
    // links e o botao Voltar trocam so o #: acompanha a aba pedida
    window.addEventListener('hashchange', () => { const x = location.hash.slice(1); if (x && document.getElementById(x) && document.getElementById(x).classList.contains('page')) goTo(x, false); });

    const track = $('.marquee-track');
    if (track.children.length && track.children[0].children.length) {
      const c = track.children[0].cloneNode(true);
      c.setAttribute('aria-hidden', 'true');
      track.appendChild(c);
    }

    // carrosseis com setas (Recem-publicadas na pagina inicial e Lancamentos)
    for (const [trilho, ant, prox] of [['#releases', '#carPrev', '#carNext'], ['#recentes', '#recPrev', '#recNext'], ['#populares', '#popPrev', '#popNext']]) {
      const car = $(trilho);
      const step = () => { const c = car.querySelector('.rel-card'); return c ? c.offsetWidth + 24 : 300; };
      $(ant).addEventListener('click', () => car.scrollBy({ left: -step() }));
      $(prox).addEventListener('click', () => car.scrollBy({ left: step() }));
    }

    // reserva (arquivo antigo): janela com a sinopse
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
      if (e.target.closest('a[href]')) return;
      const el = e.target.closest('.slide, .book-card, [data-open]');
      if (!el) return;
      e.preventDefault();
      if (el.dataset.href) location.href = el.dataset.href; // livro do banco: pagina do livro
      else open(el.dataset.id);
    });
    modal.addEventListener('click', e => { if (e.target.hasAttribute('data-close')) close(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && modal.classList.contains('open')) close(); });

    const chips = document.querySelectorAll('#chips .chip');
    chips.forEach(c => c.addEventListener('click', () => {
      chips.forEach(x => x.classList.remove('active'));
      c.classList.add('active');
      filtrar();
    }));

    // Populares: semana / mes / ano; "Veja mais" abre a Biblioteca ja ordenada pelo periodo escolhido
    const periodos = document.querySelectorAll('[data-periodo]');
    periodos.forEach((c) => c.addEventListener('click', () => {
      periodos.forEach((x) => x.classList.toggle('active', x === c));
      periodo = c.dataset.periodo; desenharPopulares();
    }));
    const campo = $('#buscaLivro');
    if (campo) campo.addEventListener('input', () => aoBuscar(campo.value));
    const sel = $('#ordem');
    sel.addEventListener('change', () => { ordem = sel.value; desenharGrade(); });
    $('#popVejaMais').addEventListener('click', (e) => {
      e.preventDefault();
      ordem = sel.value = 'pop-' + periodo; desenharGrade(); goTo('biblioteca');
    });
  }

  // livros reais do banco; projetos, noticias, selos e servicos ainda vem do data.json
  Promise.all([
    fetch('data.json').then(r => r.json()),
    fetch('/api/vitrine').then(r => r.ok ? r.json() : null).catch(() => null),
  ]).then(([d, v]) => {
    DATA = d; authors = d.autores;
    LIVROS = (v ? v.livros.map(doBanco) : d.livros.map(doArquivo)).map((b, i) => Object.assign(b, { i }));
    render(); bind();
  }).catch(() => {
    $('main').insertAdjacentHTML('afterbegin', '<p style="padding:3rem;text-align:center;color:#8c8c95">Não foi possível carregar o conteúdo.</p>');
  });
})();
