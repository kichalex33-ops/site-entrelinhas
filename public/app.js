(function(){
  'use strict';
  const $ = (s) => document.querySelector(s);
  const ENT = {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'};
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ENT[c]);
  const lines = (t) => esc(t).replace(/ /g, '<br>');
  let DATA, LIVROS = [], CATALOGO = { generos: [], tipos: [] };

  // quem assina o projeto: nome, com link para o perfil quando houver
  const byline = (nome, slug) => slug ? `<a href="autor.html?a=${encodeURIComponent(slug)}">${esc(nome || slug)}</a>` : `<b>${esc(nome || 'Coletivo Entrelinhas')}</b>`;
  const FAIXA_TXT = { L: 'Livre para todos os públicos' };
  const faixa = (f) => /^(L|10|12|14|16|18)$/.test(f || '') ? `<span class="faixa faixa-${f}" title="${esc(FAIXA_TXT[f] || 'Não recomendado para menores de ' + f + ' anos')}">${f}</span>` : '';
  const dia = (t) => new Date(t * 1000).toLocaleDateString('pt-BR');
  const mesAno = (s) => { const m = /^(\d{4})(?:-(\d{2}))?$/.exec(s || ''); return !m ? '' : m[2] ? new Date(+m[1], +m[2] - 1, 1).toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' }) : m[1]; };

  // livros vindos do banco (/api/vitrine) -> modelo unico da vitrine
  const doBanco = (l) => ({
    titulo: l.titulo, autorNome: l.autor.nome, genero: l.genero, generos: l.generos || [], tipoObra: l.tipo_obra || '', capa: l.capa,
    c1: '#1c2f4a', c2: '#070b14', href: `obra.html?a=${encodeURIComponent(l.autor.slug)}&o=${encodeURIComponent(l.id)}`,
    faixa: l.faixa, data: l.no_site_em || 0, lancamento: l.lancamento, ler: l.ler || '', aval: l.avaliacoes, pop: l.popular,
  });

  const cover = (b) => b.capa ? `<div class="cover cover-img"><img src="${esc(b.capa)}" alt="Capa de ${esc(b.titulo)}" loading="lazy"></div>` : `<div class="cover" style="--c1:${esc(b.c1)};--c2:${esc(b.c2)}"><span class="cover-title">${lines(b.titulo)}</span><span class="cover-author">${esc(b.autorNome)}</span></div>`;
  const bookAttrs = (b) => `data-href="${esc(b.href)}"`;
  const quando = (b) => b.data ? `No Entrelinhas desde ${dia(b.data)}` : '';
  const novo = (b) => b.data && Date.now() / 1000 - b.data < 30 * 86400;
  const relCard = (b) => `<article class="rel-card"><a class="cover-link" href="${esc(b.href)}" aria-label="${esc(b.titulo)}">${cover(b)}</a>${novo(b) ? '<span class="badge-new">Novo</span>' : ''}<h3>${esc(b.titulo)} ${faixa(b.faixa)}</h3><p class="by">${esc(b.autorNome)}${b.genero ? ' · ' + esc(b.genero) : ''}</p><p class="when">${esc(quando(b))}</p><a class="btn btn-ghost" href="${esc(b.href)}">Ver o livro</a></article>`;

  // popularidade (calculada no servidor: visitas unicas + favoritos + avaliacoes do periodo)
  const pop = (b, p) => (b.pop && b.pop[p]) || 0;
  const QUANDO = { semana: 'nesta semana', mes: 'neste mês', ano: 'neste ano' };
  let periodo = 'semana', ordem = 'az';

  function desenharPopulares(){
    const lista = LIVROS.filter((b) => pop(b, periodo) > 0).sort((a, b) => pop(b, periodo) - pop(a, periodo)).slice(0, 12);
    $('#populares').innerHTML = lista.map(relCard).join('') || `<p class="muted-note">Ainda não há leituras ${QUANDO[periodo]}.</p>`;
  }

  // Biblioteca: ordem escolhida + filtros de genero e tipo de obra (valem de novo depois de reordenar)
  const filtro = { genero: '', tipo: '' };
  function desenharGrade(){
    const az = (a, b) => a.titulo.localeCompare(b.titulo, 'pt');
    const p = ordem.startsWith('pop-') ? ordem.slice(4) : '';
    const livros = LIVROS.slice().sort(p ? (a, b) => pop(b, p) - pop(a, p) || az(a, b) : ordem === 'recentes' ? (a, b) => b.data - a.data || az(a, b) : az);
    $('#libraryGrid').innerHTML = livros.map(b =>
      `<article class="book-card reveal in" data-i="${b.i}" ${bookAttrs(b)}>${cover(b)}<div class="meta"><h4>${esc(b.titulo)} ${faixa(b.faixa)}</h4><p class="author">${esc(b.autorNome)}</p>${b.genero ? `<span class="tag">${esc(b.genero)}</span>` : ''}${b.ler ? '<span class="tag tag-ler">Ler no site</span>' : ''}</div></article>`).join('')
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
    let n = 0;
    document.querySelectorAll('#libraryGrid .book-card').forEach((k) => {
      const b = LIVROS[Number(k.dataset.i)];
      const ver = passa(b) && (!achados || achados.has(b.i));
      k.style.display = ver ? '' : 'none'; if (ver) n++;
    });
    const aviso = $('#buscaVazia');
    if (aviso) aviso.hidden = n > 0 || !LIVROS.length;
  }

  const passa = (b) => (!filtro.genero || b.generos.includes(filtro.genero)) && (!filtro.tipo || b.tipoObra === filtro.tipo);

  // botoes do painel: a lista fixa inteira, com quantos livros ha em cada (zero fica apagado, mas clicavel)
  function desenharFiltros(){
    const grupo = (sel, chave, itens, de) => {
      const conta = (v) => LIVROS.filter((b) => de(b, v)).length;
      $(sel).innerHTML = [['', 'Todos', LIVROS.length]].concat(itens.map((v) => [v, v, conta(v)])).map(([v, rot, n]) =>
        `<button type="button" class="chip${filtro[chave] === v ? ' active' : ''}${n ? '' : ' vazio'}" data-${chave}="${esc(v)}" aria-pressed="${filtro[chave] === v}">${esc(rot)}<small>${n}</small></button>`).join('');
    };
    grupo('#chipsGenero', 'genero', CATALOGO.generos, (b, v) => b.generos.includes(v));
    grupo('#chipsTipo', 'tipo', CATALOGO.tipos, (b, v) => b.tipoObra === v);
    const n = (filtro.genero ? 1 : 0) + (filtro.tipo ? 1 : 0);
    $('#filtrosN').hidden = !n; $('#filtrosN').textContent = n;
  }

  function render(){
    const livros = LIVROS.slice().sort((a, b) => a.titulo.localeCompare(b.titulo, 'pt'));
    const recentes = LIVROS.slice().sort((a, b) => b.data - a.data);

    // destaques: com capa primeiro, os mais recentes
    const destaques = recentes.filter((b) => b.capa).concat(recentes.filter((b) => !b.capa)).slice(0, 14);
    $('#featured').innerHTML = destaques.map(b =>
      `<figure class="slide" ${bookAttrs(b)}>${cover(b)}<figcaption>${esc(b.genero)}${b.lancamento ? ' · ' + esc(mesAno(b.lancamento)) : ''}</figcaption></figure>`).join('');

    $('#recentes').innerHTML = recentes.slice(0, 12).map(relCard).join('') || '<p class="muted-note">Os livros publicados aparecem aqui.</p>';
    $('#releases').innerHTML = recentes.slice(0, 24).map(relCard).join('');

    // #news (pagina inicial): os 3 posts mais recentes da Comunidade, montados por comunidade.js

    $('#selos').innerHTML = DATA.selos.map(s =>
      `<div class="selo reveal"><h4>${esc(s.nome)}</h4><p>${esc(s.texto)}</p></div>`).join('');

    desenharFiltros();

    desenharGrade();
    desenharPopulares();

    // projeto do Estudio sem meta de palavras nao tem porcentagem (pct = null)
    const temPct = (p) => p.pct !== null && p.pct !== undefined && p.pct !== '';
    $('#projects').innerHTML = DATA.projetos.map(p =>
      `<article class="project reveal"><div class="project-visual" style="--c1:${esc(p.c1 || '#1c2f4a')};--c2:${esc(p.c2 || '#070b14')}"><span class="project-status">${esc(p.etapa)}${temPct(p) ? ` · ${esc(p.pct)}%` : ''}</span></div><div class="project-body"><h3>${esc(p.titulo)}</h3><p class="by">${byline(p.autor, p.autor_slug)}${p.genero ? ' · ' + esc(p.genero) : ''}</p><p>${esc(p.sinopse)}</p>${p.trecho ? `<blockquote class="excerpt">${esc(p.trecho)}</blockquote>` : ''}${temPct(p) ? `<div class="progress"><span style="width:${Number(p.pct) || 0}%"></span></div>` : ''}<div class="progress-label"><span>${temPct(p) ? esc(p.pct) + '% concluído' : ''}</span><span>${p.previsao ? 'Previsão: ' + esc(p.previsao) : ''}</span></div></div></article>`).join('')
      || '<p class="muted-note">Os projetos em andamento dos autores aparecem aqui. No Estúdio, abra Informações da obra e marque "Mostrar em Projetos".</p>';

    $('#services').innerHTML = DATA.servicos.map(s =>
      `<div class="service reveal"><div class="icon">${esc(s.icone)}</div><span class="status${s.status === 'Aberto' ? ' on' : ''}">${esc(s.status)}</span><h3>${esc(s.titulo)}</h3><p>${esc(s.texto)}</p>${s.link ? `<a class="btn btn-ghost service-link" href="${esc(s.link)}">${esc(s.acao || 'Saiba mais')} &rarr;</a>` : ''}</div>`).join('');

    const contato = DATA.contato.url;
    $('#contact').innerHTML = contato
      ? `Contato: <a href="${esc(contato)}" target="_blank" rel="noopener">${esc(contato.replace(/^mailto:/, ''))}</a>`
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
      tabs.forEach(t => { t.classList.toggle('active', t.dataset.target === id); if (t.dataset.target === id) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current'); });
      pages.forEach(p => p.classList.toggle('active', p.id === id));
      watch();
      if (scroll !== false) window.scrollTo({ top: 0, behavior: 'smooth' });
      history.replaceState(null, '', '#' + id);
    };
    tabs.forEach(t => t.addEventListener('click', () => goTo(t.dataset.target)));
    document.querySelectorAll('[data-goto]').forEach(el => el.addEventListener('click', e => { e.preventDefault(); goTo(el.dataset.goto); }));
    const h = location.hash.slice(1);
    if (h && document.getElementById(h)) {
      // o navegador rola ate o elemento do # e o titulo da aba fica atras do topo: a aba aberta por link comeca no topo
      goTo(h, false);
      const topo = () => window.scrollTo(0, 0);
      requestAnimationFrame(topo); window.addEventListener('load', topo, { once: true });
    } else watch();
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

    document.addEventListener('click', e => {
      if (e.target.closest('a[href]')) return;
      const el = e.target.closest('.slide, .book-card, [data-open]');
      if (!el) return;
      e.preventDefault();
      if (el.dataset.href) location.href = el.dataset.href;
    });

    // Filtros: o botao abre e fecha o painel; clicar de novo no filtro escolhido volta para "Todos"
    const btnF = $('#filtrosBtn'), painel = $('#filtrosPainel');
    btnF.addEventListener('click', () => { painel.hidden = !painel.hidden; btnF.setAttribute('aria-expanded', String(!painel.hidden)); });
    painel.addEventListener('click', (e) => {
      const c = e.target.closest('.chip'), limpar = e.target.closest('#filtrosLimpar');
      if (!c && !limpar) return;
      if (limpar) { filtro.genero = filtro.tipo = ''; }
      else { const chave = 'genero' in c.dataset ? 'genero' : 'tipo', v = c.dataset[chave]; filtro[chave] = filtro[chave] === v ? '' : v; }
      desenharFiltros(); filtrar();
    });

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

  // tudo vem do banco: livros (/api/vitrine) e o conteudo editavel pelos moderadores (/api/site)
  const pegar = (u) => fetch(u).then((r) => { if (!r.ok) throw new Error(u); return r.json(); });
  Promise.all([pegar('/api/site'), pegar('/api/vitrine'), import('/catalogo.js')]).then(([d, v, c]) => {
    DATA = d; CATALOGO = { generos: c.GENEROS, tipos: c.TIPOS };
    LIVROS = v.livros.map(doBanco).map((b, i) => Object.assign(b, { i }));
    render(); bind();
  }).catch(() => {
    $('main').insertAdjacentHTML('afterbegin', '<p style="padding:3rem;text-align:center;color:#8c8c95">Não foi possível carregar o conteúdo.</p>');
  });
})();
