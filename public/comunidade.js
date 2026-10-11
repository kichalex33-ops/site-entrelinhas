// Aba Comunidade (index.html#comunidade): noticias, resenhas, recomendacoes de leitura e dicas de escrita.
// Ler e publico; autores e moderadores postam (o servidor confere: src/comunidade.js). Texto simples, sempre escapado.
(function(){
  'use strict';
  const $ = (s) => document.querySelector(s);
  const { esc, paras, api } = window.EL;
  const RESUMO = 420; // caracteres antes do "Ler tudo"
  let TIPOS = { noticia: 'Notícia', resenha: 'Resenha', recomendacao: 'Recomendação de leitura', dica: 'Dica de escrita' };
  let EU = null, tipo = '', mais = null, posts = [];

  const dia = (t) => new Date(t * 1000).toLocaleDateString('pt-BR');
  const assinatura = (a) => a.slug ? `<a href="autor.html?a=${encodeURIComponent(a.slug)}">${esc(a.nome)}</a>` : `<b>${esc(a.nome)}</b>`;

  // cartao de um post; `curto` = pagina inicial (sem acoes, so o resumo)
  function cartao(p, curto) {
    const longo = p.texto.length > RESUMO;
    const texto = curto || longo ? p.texto.slice(0, RESUMO).replace(/\s+\S*$/, '') + '…' : p.texto;
    const acoes = curto ? '' : [
      p.meu ? `<button type="button" class="com-acao" data-editar="${p.id}">Editar</button>` : '',
      p.meu || (EU && EU.mod) ? `<button type="button" class="com-acao" data-apagar="${p.id}">Apagar</button>` : '',
      EU && EU.mod ? `<button type="button" class="com-acao" data-ocultar="${p.id}" data-v="${p.oculto ? 0 : 1}">${p.oculto ? 'Mostrar de novo' : 'Ocultar'}</button>` : '',
    ].join('');
    return `<article class="post com-post${p.oculto ? ' com-oculto' : ''}" data-id="${p.id}">
      <span class="date">${esc(dia(p.criado_em))} · ${esc(TIPOS[p.tipo] || p.tipo)}${p.oculto ? ' · oculto' : ''}</span>
      <h4>${esc(p.titulo)}</h4>
      ${p.livro ? `<p class="com-livro">Sobre: <b>${esc(p.livro)}</b></p>` : ''}
      <div class="com-texto">${paras(curto || longo ? texto : p.texto)}</div>
      ${!curto && longo ? `<button type="button" class="com-acao" data-ler="${p.id}">Ler tudo</button>` : ''}
      ${!curto && p.link ? `<p><a class="com-link" href="${esc(p.link)}" target="_blank" rel="noopener noreferrer">${esc(p.link.replace(/^https?:\/\//, '').slice(0, 60))}</a></p>` : ''}
      <p class="byline">por ${assinatura(p.autor)}${p.editado_em ? ' · editado' : ''}</p>
      ${acoes ? `<div class="com-acoes">${acoes}</div>` : ''}
    </article>`;
  }

  async function carregar(acrescentar) {
    const q = new URLSearchParams();
    if (tipo) q.set('tipo', tipo);
    if (acrescentar && mais) q.set('antes', mais);
    try {
      const r = await api('/api/comunidade?' + q);
      TIPOS = r.tipos || TIPOS; EU = r.eu; mais = r.mais;
      posts = acrescentar ? posts.concat(r.posts) : r.posts;
      desenhar();
    } catch (e) { $('#comLista').innerHTML = `<p class="muted-note">Não foi possível carregar a Comunidade.</p>`; }
  }

  function desenhar() {
    $('#comTipos').innerHTML = [['', 'Todos']].concat(Object.entries(TIPOS)).map(([v, rot]) =>
      `<button type="button" class="chip${tipo === v ? ' active' : ''}" data-tipo="${esc(v)}" aria-pressed="${tipo === v}">${esc(rot)}</button>`).join('');
    $('#comLista').innerHTML = posts.map((p) => cartao(p)).join('')
      || `<p class="muted-note">${tipo ? 'Ainda não há posts deste tipo.' : 'Ainda não há posts.'} ${EU && EU.pode_postar ? 'Que tal escrever o primeiro?' : ''}</p>`;
    $('#comMais').hidden = !mais;
    $('#comEscrever').hidden = !(EU && EU.pode_postar);
    $('#comAviso').hidden = !!(EU && EU.pode_postar);
  }

  // janela de escrever/editar
  function janela(p) {
    const dlg = document.createElement('dialog');
    dlg.className = 'el-dialogo';
    const o = p || { tipo: 'noticia', titulo: '', texto: '', livro: '', link: '' };
    dlg.innerHTML = `<h2>${p ? 'Editar post' : 'Escrever post'}</h2>
      <form class="el-dialogo-corpo el-form" novalidate>
        <label class="fld"><span>Tipo</span><select name="tipo">${Object.entries(TIPOS).map(([v, rot]) => `<option value="${v}"${o.tipo === v ? ' selected' : ''}>${esc(rot)}</option>`).join('')}</select></label>
        <label class="fld"><span>Título</span><input name="titulo" maxlength="120" value="${esc(o.titulo)}"></label>
        <label class="fld com-fld-livro"><span>Livro (título e autor)</span><input name="livro" maxlength="160" value="${esc(o.livro)}" placeholder="ex.: Dom Casmurro, de Machado de Assis"></label>
        <label class="fld"><span>Texto</span><textarea name="texto" rows="9" maxlength="6000">${esc(o.texto)}</textarea><small class="hint">Texto simples. Deixe uma linha em branco entre os parágrafos.</small></label>
        <label class="fld"><span>Link (opcional)</span><input name="link" type="url" maxlength="300" value="${esc(o.link)}" placeholder="https://..."></label>
        <div class="com-estado" role="status"></div>
      </form>
      <div class="el-dialogo-rodape"><button type="button" class="btn btn-ghost" data-fechar>Cancelar</button><button type="button" class="btn btn-primary" data-enviar>${p ? 'Salvar' : 'Publicar'}</button></div>`;
    const f = dlg.querySelector('form'), estado = dlg.querySelector('.com-estado');
    const livroVisivel = () => { dlg.querySelector('.com-fld-livro').hidden = !['resenha', 'recomendacao'].includes(f.tipo.value); };
    f.tipo.addEventListener('change', livroVisivel); livroVisivel();
    dlg.querySelector('[data-fechar]').addEventListener('click', () => dlg.close());
    dlg.querySelector('[data-enviar]').addEventListener('click', async (e) => {
      const b = e.currentTarget;
      const dados = { tipo: f.tipo.value, titulo: f.titulo.value, texto: f.texto.value, link: f.link.value, livro: dlg.querySelector('.com-fld-livro').hidden ? '' : f.livro.value };
      b.disabled = true; estado.innerHTML = '<p class="note ok">Enviando...</p>';
      try {
        await api(p ? `/api/comunidade/${p.id}` : '/api/comunidade', { method: p ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(dados) });
        dlg.close(); if (!p) tipo = ''; carregar(); recentes();
      } catch (err) { estado.innerHTML = `<p class="note err">${esc(err.message)}</p>`; b.disabled = false; }
    });
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg); dlg.showModal();
  }

  function ligar() {
    $('#comTipos').addEventListener('click', (e) => { const c = e.target.closest('.chip'); if (!c) return; tipo = c.dataset.tipo; mais = null; carregar(); });
    $('#comMais').addEventListener('click', () => carregar(true));
    $('#comEscrever').addEventListener('click', () => janela(null));
    $('#comLista').addEventListener('click', async (e) => {
      const b = e.target.closest('.com-acao'); if (!b) return;
      const id = Number(b.dataset.ler || b.dataset.editar || b.dataset.apagar || b.dataset.ocultar);
      const p = posts.find((x) => x.id === id); if (!p) return;
      if (b.dataset.ler) { const art = b.closest('.com-post'); art.querySelector('.com-texto').innerHTML = paras(p.texto); b.remove(); return; }
      if (b.dataset.editar) return janela(p);
      try {
        if (b.dataset.apagar) {
          if (!window.confirm('Apagar este post? Não dá para desfazer.')) return;
          await api(`/api/comunidade/${id}`, { method: 'DELETE' });
        } else {
          await api(`/api/comunidade/${id}/ocultar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ocultar: b.dataset.v === '1' }) });
        }
        carregar(); recentes();
      } catch (err) { window.alert(err.message); }
    });
  }

  // pagina inicial: os 3 posts mais recentes no lugar das antigas noticias
  async function recentes() {
    const box = $('#news'); if (!box) return;
    try {
      const r = await api('/api/comunidade?n=3');
      TIPOS = r.tipos || TIPOS;
      box.innerHTML = r.posts.map((p) => cartao(p, true)).join('') || '<p class="muted-note">Os posts da Comunidade aparecem aqui.</p>';
    } catch (e) { box.innerHTML = ''; }
  }

  if ($('#comLista')) { ligar(); carregar(); }
  recentes();
})();
