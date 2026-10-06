// Modo claro / escuro. Carregado no <head> de todas as paginas (antes do CSS pintar, para nao piscar).
// O escuro e o visual original e o padrao; a escolha fica neste navegador (localStorage).
(function () {
  'use strict';
  var raiz = document.documentElement;
  var COR = { escuro: '#000000', claro: '#f6f2ea' };
  var tema = 'escuro';
  try { if (localStorage.getItem('el:tema') === 'claro') tema = 'claro'; } catch (e) { /* armazenamento bloqueado */ }

  function aplicar(t) {
    tema = t;
    raiz.setAttribute('data-tema', t);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', COR[t]);
    var b = document.querySelector('.tema-bt');
    if (b) {
      b.textContent = t === 'claro' ? '☾' : '☀';
      b.setAttribute('aria-label', t === 'claro' ? 'Mudar para o modo escuro' : 'Mudar para o modo claro');
      b.title = b.getAttribute('aria-label');
    }
  }
  aplicar(tema);

  document.addEventListener('DOMContentLoaded', function () {
    var cab = document.querySelector('.site-header');
    if (!cab) return;
    // canto superior direito: tema + conta (menu.js poe o "Entrar" ou a foto ao lado)
    var topo = cab.querySelector('.topo-acoes');
    if (!topo) { topo = document.createElement('div'); topo.className = 'topo-acoes'; cab.appendChild(topo); }
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'tema-bt';
    topo.insertBefore(b, topo.firstChild);
    aplicar(tema);
    b.addEventListener('click', function () {
      aplicar(tema === 'claro' ? 'escuro' : 'claro');
      try { localStorage.setItem('el:tema', tema); } catch (e) { /* so nesta visita */ }
    });
  });

  // Rastro do mouse (mesmo efeito do Sinal/Ruido, em dourado): uma grade invisivel de
  // quadradinhos atras da pagina que acende perto do cursor e se apaga aos poucos.
  // Fica fora da leitura e do estudio, de telas de toque e de quem pede menos movimento.
  document.addEventListener('DOMContentLoaded', function () {
    if (/^\/(ler|estudio)(\.html)?(\/|$)/.test(location.pathname)) return;
    if (!window.matchMedia || !matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    var PASSO = 14, RAIO = 100;
    var tela = document.createElement('canvas');
    tela.className = 'rastro-mouse';
    tela.setAttribute('aria-hidden', 'true');
    document.body.insertBefore(tela, document.body.firstChild);
    var ctx = tela.getContext('2d');
    if (!ctx) return;
    var cols = 0, lins = 0, luz = new Float32Array(0), quadro = null;

    function medir() {
      tela.width = window.innerWidth;
      tela.height = window.innerHeight;
      cols = Math.ceil(tela.width / PASSO);
      lins = Math.ceil(tela.height / PASSO);
      luz = new Float32Array(cols * lins);
    }

    function acender(x, y) {
      var cx = Math.floor(x / PASSO), cy = Math.floor(y / PASSO), alcance = Math.ceil(RAIO / PASSO);
      for (var dy = -alcance; dy <= alcance; dy++) {
        for (var dx = -alcance; dx <= alcance; dx++) {
          var c = cx + dx, l = cy + dy;
          if (c < 0 || l < 0 || c >= cols || l >= lins) continue;
          var d = Math.hypot(dx * PASSO, dy * PASSO);
          if (d > RAIO) continue;
          var i = l * cols + c;
          luz[i] = Math.max(luz[i], 1 - d / RAIO);
        }
      }
    }

    // o dourado vem do --accent do tema atual (#d9a94a no escuro, #9c6c14 no claro)
    var corTema = null, cor = '217, 169, 74';
    function lerCor() {
      if (corTema === tema) return;
      corTema = tema;
      var hex = getComputedStyle(raiz).getPropertyValue('--accent').trim();
      var m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
      if (m) cor = parseInt(m[1], 16) + ', ' + parseInt(m[2], 16) + ', ' + parseInt(m[3], 16);
    }

    function desenhar() {
      ctx.clearRect(0, 0, tela.width, tela.height);
      lerCor();
      var aceso = false;
      for (var l = 0; l < lins; l++) {
        for (var c = 0; c < cols; c++) {
          var i = l * cols + c, v = luz[i];
          if (v <= 0.01) continue;
          aceso = true;
          luz[i] = Math.max(0, v - 0.045);
          var lado = 2 + v * 3;
          ctx.fillStyle = 'rgba(' + cor + ', ' + (v * 0.5) + ')';
          ctx.fillRect(c * PASSO + (PASSO - lado) / 2, l * PASSO + (PASSO - lado) / 2, lado, lado);
        }
      }
      quadro = aceso ? requestAnimationFrame(desenhar) : null;
    }

    window.addEventListener('mousemove', function (e) {
      acender(e.clientX, e.clientY);
      if (!quadro) quadro = requestAnimationFrame(desenhar);
    }, { passive: true });
    window.addEventListener('resize', medir);
    medir();
  });
})();
