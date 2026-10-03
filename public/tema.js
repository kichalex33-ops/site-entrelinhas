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
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'tema-bt';
    cab.appendChild(b);
    aplicar(tema);
    b.addEventListener('click', function () {
      aplicar(tema === 'claro' ? 'escuro' : 'claro');
      try { localStorage.setItem('el:tema', tema); } catch (e) { /* so nesta visita */ }
    });
  });
})();
