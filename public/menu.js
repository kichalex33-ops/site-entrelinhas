// Topo de todas as paginas:
//  - canto superior direito: "Criar conta" (leitor) e "Entrar" para quem nao entrou; a foto (ou inicial) de quem entrou,
//    com um menu (Meu perfil, Minha conta, Estudio, Sair)
//  - menu principal: leitor logado ganha "Meu perfil" ao lado de Autores
//  - rodape: o link "Feedback do beta" leva junto a pagina de onde a pessoa veio
(function () {
  'use strict';
  var ENT = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  var esc = function (v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return ENT[c]; }); };
  var img = function (id) { return !id ? '' : id.charAt(0) === '/' ? id : '/img/' + id + '?v=2'; };

  function cantinho(cab) {
    var topo = cab.querySelector('.topo-acoes');
    if (!topo) { topo = document.createElement('div'); topo.className = 'topo-acoes'; cab.appendChild(topo); }
    return topo;
  }

  document.addEventListener('DOMContentLoaded', async function () {
    // rodape: "Feedback do beta" leva a pagina de origem (so o caminho, sem parametros: nunca um token de link)
    // menu principal: o item da pagina atual e anunciado pelos leitores de tela
    document.querySelectorAll('.tabs a.tab.active').forEach(function (t) { t.setAttribute('aria-current', 'page'); });
    var fb = document.querySelector('.f-feedback');
    if (fb) fb.href = 'feedback.html?de=' + encodeURIComponent(location.pathname);
    var cab = document.querySelector('.site-header');
    if (!cab) return;
    var me = null;
    try { var r = await fetch('/api/me'); if (r.ok) me = await r.json(); } catch (e) { /* sem rede: mostra Entrar */ }
    var topo = cantinho(cab);

    if (!me) {
      if (!/\/conta(\.html)?$/.test(location.pathname)) topo.insertAdjacentHTML('beforeend', '<a class="topo-criar" href="conta.html#criar">Criar conta</a><a class="topo-entrar" href="conta.html">Entrar</a>');
      return;
    }

    var perfil = me.role === 'autor' ? 'autor.html?a=' + encodeURIComponent(me.slug) : 'leitor.html?u=' + encodeURIComponent(me.slug);
    var inicial = esc((me.nome || '?').trim().charAt(0).toUpperCase());
    topo.insertAdjacentHTML('beforeend',
      '<div class="topo-conta">' +
        '<button type="button" class="topo-foto" aria-haspopup="true" aria-expanded="false" title="' + esc(me.nome) + '" aria-label="Menu da conta de ' + esc(me.nome) + '">' +
          (me.foto ? '<img src="' + esc(img(me.foto)) + '" alt="">' : '<span>' + inicial + '</span>') + '</button>' +
        '<div class="topo-menu" hidden>' +
          '<p class="topo-nome">' + esc(me.nome) + '</p>' +
          '<a href="' + perfil + '">Meu perfil</a>' +
          '<a href="conta.html">Minha conta</a>' +
          (me.role === 'autor' ? '<a href="estudio.html">Estúdio de escrita</a><a href="lixeira.html">Lixeira de livros</a>' : '') +
          '<button type="button" data-sair>Sair</button>' +
        '</div></div>');
    var bt = topo.querySelector('.topo-foto'), menu = topo.querySelector('.topo-menu');
    var abrir = function (sim) { menu.hidden = !sim; bt.setAttribute('aria-expanded', String(sim)); };
    bt.addEventListener('click', function (e) { e.stopPropagation(); abrir(menu.hidden); });
    document.addEventListener('click', function (e) { if (!menu.hidden && !menu.contains(e.target)) abrir(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') abrir(false); });
    menu.querySelector('[data-sair]').addEventListener('click', async function () {
      try { await fetch('/api/logout', { method: 'POST', headers: { 'X-Requested-With': 'fetch' } }); } catch (e) { /* segue */ }
      location.href = 'index.html';
    });

    // leitor: "Meu perfil" tambem no menu principal, marcado na propria pagina
    var nav = cab.querySelector('.tabs');
    if (nav && me.role === 'leitor') {
      var a = document.createElement('a');
      a.className = 'tab';
      a.href = perfil;
      a.textContent = 'Meu perfil';
      if (/\/leitor(\.html)?$/.test(location.pathname) && new URLSearchParams(location.search).get('u') === me.slug) {
        nav.querySelectorAll('.tab.active').forEach(function (t) { t.classList.remove('active'); });
        a.classList.add('active');
      }
      nav.appendChild(a);
    }
  });
})();
