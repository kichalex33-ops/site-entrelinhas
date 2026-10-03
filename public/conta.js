(function(){
  'use strict';
  const { esc, imgUrl, api } = EL;
  const app = document.getElementById('app');
  const subtitle = document.getElementById('subtitle');
  const STATUS = ['Publicado', 'Em desenvolvimento', 'Em escrita', 'Revisão', 'Em breve'];
  const FUNDOS = [['preto', 'Preto'], ['azul', 'Azul noite'], ['vinho', 'Vinho'], ['verde', 'Verde escuro'], ['grafite', 'Grafite']];
  let P = null, slug = '', isMod = false;

  const field = (label, html) => `<label class="fld"><span>${label}</span>${html}</label>`;
  const input = (path, val, extra = '') => `<input data-k="${path}" value="${esc(val)}" ${extra}>`;
  const area = (path, val, rows = 4, max = 4000) => `<textarea data-k="${path}" rows="${rows}" maxlength="${max}">${esc(val)}</textarea>`;
  const note = (t, ok) => `<p class="note ${ok ? 'ok' : 'err'}" role="status">${esc(t)}</p>`;

  // ---------- captcha (Turnstile) no cadastro de leitor ----------
  let tsId = null;
  async function mountTurnstile(){
    const box = document.getElementById('tsBox');
    if (!box) return;
    let cfg;
    try { cfg = await api('/api/config'); } catch (e) { return; }
    if (!cfg.turnstile) return; // sem chave (ambiente local): sem captcha
    await new Promise((ok, no) => {
      if (window.turnstile) return ok();
      const s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      s.async = true; s.onload = ok; s.onerror = no; document.head.appendChild(s);
    }).catch(() => {});
    if (window.turnstile) tsId = window.turnstile.render(box, { sitekey: cfg.turnstile, theme: 'dark', language: 'pt-br' });
  }

  // ---------- login / cadastro ----------
  // servidor local (iniciar-local): mostra as contas de teste criadas por scripts/dev-contas.mjs
  const LOCAL = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  const CONTAS_LOCAIS = [['alex@local.test', 'Alex Jr. Kich (autor + moderador)'], ['autor@local.test', 'Autor Teste'], ['leitor@local.test', 'Leitor Teste']];
  function authView(mode){
    tsId = null;
    subtitle.textContent = mode === 'leitor' ? 'Crie uma conta de leitor para avaliar obras.' : 'Entre para editar a sua página pública ou avaliar obras.';
    app.innerHTML = `
      <div class="auth-box">
        <div class="auth-tabs">
          <button class="${mode === 'login' ? 'on' : ''}" data-mode="login">Entrar</button>
          <button class="${mode === 'leitor' ? 'on' : ''}" data-mode="leitor">Sou leitor</button>
          <button class="${mode === 'register' ? 'on' : ''}" data-mode="register">Sou autor</button>
        </div>
        <form id="authForm" autocomplete="on">
          ${mode === 'register' ? field('Código de convite', '<input name="convite" required autocomplete="off">') + field('Seu nome (aparece na página)', '<input name="nome" maxlength="80" autocomplete="name">') : ''}
          ${mode === 'leitor' ? field('Seu nome (aparece nas suas avaliações)', '<input name="nome" maxlength="40" minlength="2" required autocomplete="nickname">') : ''}
          ${field('E-mail', '<input name="email" type="email" required autocomplete="email">')}
          ${field('Senha' + (mode !== 'login' ? ' (mínimo 10 caracteres)' : ''), `<input name="senha" type="password" required minlength="${mode !== 'login' ? 10 : 1}" autocomplete="${mode !== 'login' ? 'new-password' : 'current-password'}">`)}
          ${mode === 'leitor' ? '<div id="tsBox" style="margin:.4rem 0"></div>' : ''}
          <button class="btn btn-primary" type="submit">${mode === 'login' ? 'Entrar' : mode === 'leitor' ? 'Criar conta de leitor' : 'Criar conta de autor'}</button>
          <div id="authNote"></div>
        </form>
        <p class="hint">${mode === 'register'
          ? 'O cadastro de autor é fechado: precisa de um código de convite do coletivo. O e-mail serve só para entrar e nunca aparece no site.'
          : mode === 'leitor'
          ? 'Conta de leitor é aberta a todos. Você pode avaliar obras, marcar avaliações como úteis e denunciar abusos. O e-mail serve só para entrar e nunca aparece no site.'
          : 'Esqueceu a senha? Peça ao coletivo para redefinir.'}</p>
        ${mode === 'login' && LOCAL ? `<p class="hint"><b>Rodando no seu computador.</b> As contas do site real não existem aqui. Entre com uma conta de teste (senha <code>entrelinhas123</code>):<br>${CONTAS_LOCAIS.map(([em, rot]) => `<button type="button" class="btn btn-ghost" data-local="${em}" style="margin:.4rem .4rem 0 0">${rot}</button>`).join('')}</p>` : ''}
      </div>`;
    app.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => authView(b.dataset.mode)));
    app.querySelectorAll('[data-local]').forEach(b => b.addEventListener('click', () => {
      const f = document.getElementById('authForm');
      f.email.value = b.dataset.local; f.senha.value = 'entrelinhas123'; f.requestSubmit();
    }));
    if (mode === 'leitor') mountTurnstile();
    document.getElementById('authForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      if (mode === 'leitor' && tsId !== null && window.turnstile) f.turnstile = window.turnstile.getResponse(tsId);
      const btn = e.target.querySelector('button[type=submit]'); btn.disabled = true;
      try {
        await api('/api/' + (mode === 'leitor' ? 'register-leitor' : mode), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f) });
        await load();
      } catch (err) {
        document.getElementById('authNote').innerHTML = note(err.message);
        if (tsId !== null && window.turnstile) window.turnstile.reset(tsId);
        btn.disabled = false;
      }
    });
  }

  // ---------- conta de leitor ----------
  function readerView(me){
    subtitle.textContent = 'Conta de leitor.';
    app.innerHTML = `
      <div class="auth-box">
        <p>Olá, <b>${esc(me.nome)}</b>! Você pode avaliar obras, marcar avaliações como úteis e denunciar abusos nas páginas dos autores.</p>
        <p style="margin:1rem 0"><a class="btn btn-primary" href="autores.html">Ver autores e obras</a> <button class="btn btn-ghost" id="logout" type="button">Sair</button></p>
        <details class="blk pw"><summary>Trocar senha</summary>
          <form id="pwForm">
            ${field('Senha atual', '<input name="atual" type="password" autocomplete="current-password" required>')}
            ${field('Nova senha (mínimo 10 caracteres)', '<input name="nova" type="password" autocomplete="new-password" minlength="10" required>')}
            <button class="btn btn-ghost" type="submit">Trocar senha</button><span id="pwNote"></span>
          </form></details>
      </div>`;
    document.getElementById('logout').addEventListener('click', async () => { await api('/api/logout', { method: 'POST' }); authView('login'); });
    document.getElementById('pwForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const n = document.getElementById('pwNote');
      try {
        await api('/api/password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(e.target))) });
        n.innerHTML = note('Senha trocada.', true); e.target.reset();
      } catch (err) { n.innerHTML = note(err.message); }
    });
  }

  // ---------- editor ----------
  function listBlock(key, title, addLabel, itemHtml){
    return `<fieldset class="blk"><legend>${title}</legend>
      <div id="list-${key}">${P[key].map((it, i) => `<div class="item" data-i="${i}">${itemHtml(it, i)}<button type="button" class="rm" data-rm="${key}:${i}">Remover</button></div>`).join('')}</div>
      <button type="button" class="btn btn-ghost add" data-add="${key}">${addLabel}</button></fieldset>`;
  }

  function editorView(){
    subtitle.textContent = 'Tudo o que você editar aqui aparece na sua página pública.';
    app.innerHTML = `
      <div class="bar">
        <a class="btn btn-ghost" href="autor.html?a=${encodeURIComponent(slug)}" target="_blank" rel="noopener">Ver minha página pública</a>
        <a class="btn btn-ghost" href="estudio.html">Estúdio de escrita</a>
        ${isMod ? '<a class="btn btn-ghost" href="chat.html">Chat da moderação</a>' : ''}
        <button class="btn btn-ghost" id="logout" type="button">Sair</button>
      </div>
      <form id="ed" class="ed-form" autocomplete="off">
        <datalist id="lojas-sug">${['Amazon', 'Clube de Autores', 'Uiclap', 'Mercado Livre', 'Shopee', 'Hotmart', 'Kobo', 'Google Play Livros', 'Site do autor'].map(n => `<option value="${n}">`).join('')}</datalist>
        <fieldset class="blk"><legend>Perfil</legend>
          ${field('Nome', input('nome', P.nome, 'maxlength="80" required'))}
          ${field('Frase de apresentação', input('frase', P.frase, 'maxlength="160"'))}
          ${field('Cidade ou região (opcional)', input('local', P.local, 'maxlength="80"'))}
          ${field('Sobre você (separe parágrafos com uma linha em branco)', area('bio', P.bio, 6, 1200))}
          ${field('Frase de destaque', input('citacao', P.citacao, 'maxlength="200"'))}
          <div class="photo-row">
            <div class="photo-prev" id="prev-retrato">${P.retrato ? `<img src="${esc(imgUrl(P.retrato))}" alt="">` : '<span>Sem foto</span>'}</div>
            <div><span class="lbl">Foto de perfil</span>
              <input type="file" accept="image/jpeg,image/png,image/webp" data-up="retrato">
              ${P.retrato ? '<button type="button" class="rm" data-clear="retrato">Remover foto</button>' : ''}
              <p class="hint">Formatos aceitos: JPG, PNG ou WebP. A imagem é reduzida automaticamente (até 600 KB). Outros formatos, como HEIC ou GIF, não são aceitos.</p></div>
          </div>
        </fieldset>

        <fieldset class="blk"><legend>Aparência</legend>
          ${field('Cor de destaque', `<input type="color" data-k="cor" value="${esc(P.cor)}">`)}
          ${field('Fundo', `<select data-k="fundo">${FUNDOS.map(([v, t]) => `<option value="${v}"${P.fundo === v ? ' selected' : ''}>${t}</option>`).join('')}</select>`)}
        </fieldset>

        ${listBlock('links', 'Links (o primeiro vira o botão principal)', 'Adicionar link', (l, i) =>
          field('Texto do botão', input(`links.${i}.rotulo`, l.rotulo, 'maxlength="40"')) + field('Endereço (https://...)', input(`links.${i}.url`, l.url, 'maxlength="300" type="url"')))}

        ${listBlock('obras', 'Obras', 'Adicionar obra', (o, i) =>
          field('Título', input(`obras.${i}.titulo`, o.titulo, 'maxlength="120"')) +
          field('Gênero', input(`obras.${i}.genero`, o.genero, 'maxlength="60"')) +
          field('Situação', `<select data-k="obras.${i}.status">${STATUS.map(s => `<option${o.status === s ? ' selected' : ''}>${s}</option>`).join('')}</select>`) +
          field('Sinopse', area(`obras.${i}.sinopse`, o.sinopse, 4, 1500)) +
          field('Link principal (compra ou leitura)', input(`obras.${i}.link`, o.link, 'maxlength="300" type="url"')) +
          `<div class="lojas"><span class="lbl">Outras lojas onde comprar (até 6)</span>
            ${(o.lojas || []).map((l, j) => `<div class="loja-row">
              ${input(`obras.${i}.lojas.${j}.rotulo`, l.rotulo, 'maxlength="40" list="lojas-sug" placeholder="Loja (ex.: Amazon)"')}
              ${input(`obras.${i}.lojas.${j}.url`, l.url, 'maxlength="300" type="url" placeholder="https://..."')}
              <button type="button" class="rm" data-rmloja="${i}:${j}">Remover</button></div>`).join('')}
            <button type="button" class="btn btn-ghost add" data-addloja="${i}">Adicionar loja</button></div>` +
          `<div class="photo-row"><div class="photo-prev small" id="prev-capa-${i}">${o.capa ? `<img src="${esc(imgUrl(o.capa))}" alt="">` : '<span>Sem capa</span>'}</div>
            <div><span class="lbl">Capa</span><input type="file" accept="image/jpeg,image/png,image/webp" data-up="obras.${i}.capa"><p class="hint">JPG, PNG ou WebP.</p>
            ${o.capa ? `<button type="button" class="rm" data-clear="obras.${i}.capa">Remover capa</button>` : ''}</div></div>`)}

        ${listBlock('secoes', 'Seções de texto', 'Adicionar seção', (s, i) =>
          field('Título', input(`secoes.${i}.titulo`, s.titulo, 'maxlength="80"')) + field('Texto', area(`secoes.${i}.texto`, s.texto, 6, 4000)))}

        <div class="save-row"><button class="btn btn-primary" type="submit" id="saveBtn">Salvar alterações</button><span id="saveNote"></span></div>
      </form>

      <details class="blk pw"><summary>Trocar senha</summary>
        <form id="pwForm">
          ${field('Senha atual', '<input name="atual" type="password" autocomplete="current-password" required>')}
          ${field('Nova senha (mínimo 10 caracteres)', '<input name="nova" type="password" autocomplete="new-password" minlength="10" required>')}
          <button class="btn btn-ghost" type="submit">Trocar senha</button><span id="pwNote"></span>
        </form>
      </details>`;
    bindEditor();
  }

  const getAt = (o, path) => path.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
  function setAt(o, path, v){
    const ks = path.split('.'); const last = ks.pop();
    const t = ks.reduce((a, k) => a[k], o); t[last] = v;
  }

  function bindEditor(){
    const form = document.getElementById('ed');
    form.addEventListener('input', (e) => { const k = e.target.dataset.k; if (k) setAt(P, k, e.target.value); });
    form.addEventListener('change', (e) => { const k = e.target.dataset.k; if (k) setAt(P, k, e.target.value); });

    form.addEventListener('click', (e) => {
      const t = e.target;
      if (t.dataset.add) {
        const blank = { links: { rotulo: '', url: '' }, obras: { titulo: '', genero: '', status: 'Publicado', sinopse: '', capa: '', link: '', lojas: [] }, secoes: { titulo: '', texto: '' } }[t.dataset.add];
        const max = { links: 8, obras: 20, secoes: 8 }[t.dataset.add];
        if (P[t.dataset.add].length >= max) return alert('Limite atingido.');
        P[t.dataset.add].push(blank); editorView();
      } else if (t.dataset.addloja) {
        const o = P.obras[Number(t.dataset.addloja)]; o.lojas = o.lojas || [];
        if (o.lojas.length >= 6) return alert('Limite de 6 lojas por obra.');
        o.lojas.push({ rotulo: '', url: '' }); editorView();
      } else if (t.dataset.rmloja) {
        const [i, j] = t.dataset.rmloja.split(':'); P.obras[Number(i)].lojas.splice(Number(j), 1); editorView();
      } else if (t.dataset.rm) {
        const [k, i] = t.dataset.rm.split(':'); P[k].splice(Number(i), 1); editorView();
      } else if (t.dataset.clear) {
        setAt(P, t.dataset.clear, ''); editorView();
      }
    });

    form.querySelectorAll('[data-up]').forEach(inp => inp.addEventListener('change', async () => {
      const f = inp.files[0]; if (!f) return;
      const holder = inp.closest('.photo-row');
      try {
        const blob = await shrink(f);
        const r = await fetch('/api/image', { method: 'POST', headers: { 'X-Requested-With': 'fetch', 'Content-Type': blob.type }, body: blob });
        const d = await r.json(); if (!r.ok) throw new Error(d.erro || 'Falha no envio.');
        setAt(P, inp.dataset.up, d.id); editorView();
        document.getElementById('saveNote').innerHTML = note('Imagem enviada. Clique em "Salvar alterações" para publicar.', true);
      } catch (err) {
        holder.insertAdjacentHTML('beforeend', note(err.message));
      }
    }));

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.getElementById('saveBtn'), n = document.getElementById('saveNote');
      btn.disabled = true; n.innerHTML = '';
      try {
        const r = await api('/api/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: P }) });
        P = r.data; n.innerHTML = note('Salvo. Já está na sua página pública.', true);
      } catch (err) { n.innerHTML = note(err.message); }
      btn.disabled = false;
    });

    document.getElementById('logout').addEventListener('click', async () => {
      await api('/api/logout', { method: 'POST' }); P = null; authView('login');
    });

    document.getElementById('pwForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const n = document.getElementById('pwNote');
      try {
        await api('/api/password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(e.target))) });
        n.innerHTML = note('Senha trocada.', true); e.target.reset();
      } catch (err) { n.innerHTML = note(err.message); }
    });
  }

  // reduz a imagem no navegador para caber no limite do servidor (600 KB)
  async function shrink(file){
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('Envie uma imagem JPEG, PNG ou WebP.');
    const bmp = await createImageBitmap(file);
    let max = 1000;
    for (let tries = 0; tries < 6; tries++) {
      const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas'); c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      const blob = await new Promise(res => c.toBlob(res, 'image/jpeg', 0.85));
      if (blob && blob.size <= 550 * 1024) return blob;
      max = Math.round(max * 0.8);
    }
    throw new Error('Não foi possível reduzir a imagem. Tente uma menor.');
  }

  // atalhos vindos da pagina publica: #nova-obra cria um livro em branco; #obra-<id> abre aquele livro
  function openFromHash(){
    const h = location.hash;
    if (!h) return;
    history.replaceState(null, '', location.pathname + location.search);
    let idx = -1;
    if (h === '#nova-obra') {
      if (P.obras.length >= 20) return alert('Limite de 20 obras atingido.');
      P.obras.push({ titulo: '', genero: '', status: 'Publicado', sinopse: '', capa: '', link: '', lojas: [] });
      editorView(); idx = P.obras.length - 1;
    } else if (h.indexOf('#obra-') === 0) idx = P.obras.findIndex(o => o.id === h.slice(6));
    const el = idx >= 0 ? document.querySelector('#list-obras .item[data-i="' + idx + '"]') : null;
    if (el) { el.scrollIntoView({ block: 'start' }); const f = el.querySelector('input,textarea'); if (f) f.focus(); }
  }

  async function load(){
    try {
      const me = await api('/api/me');
      slug = me.slug; isMod = !!me.mod;
      if (me.role === 'leitor') return readerView(me);
      const p = await api('/api/profile/' + slug);
      P = p.data; editorView(); openFromHash();
    } catch (e) { authView('login'); }
  }
  load();
})();
