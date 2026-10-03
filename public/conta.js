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
          : '<a href="recuperar.html">Esqueci minha senha</a>'}</p>
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
    app.dataset.mod = isMod ? '1' : ''; // moderacao.js so monta o painel para moderadores
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

        <fieldset class="blk" id="obras-blk"><legend>Obras</legend>
          <p class="hint">Obras escritas ou carregadas no Estúdio aparecem sozinhas na sua página quando você publica. Aqui ficam também os livros que você divulga com link de compra.</p>
          <div class="obras-lista">${P.obras.map((o, i) => `<div class="obra-item">
            <div class="obra-mini">${o.capa ? `<img src="${esc(imgUrl(o.capa))}" alt="">` : `<span>${esc((o.titulo || '?').trim().charAt(0).toUpperCase())}</span>`}</div>
            <div class="obra-info"><b>${esc(o.titulo || 'Sem título')} ${EL.faixa(o.faixa)}</b><span class="hint">${esc([o.status, o.genero, EL.mesAno(o.publicado_em)].filter(Boolean).join(' · '))}</span></div>
            <div class="obra-acoes"><button type="button" class="btn btn-ghost" data-editobra="${i}">Editar</button><button type="button" class="rm" data-rmobra="${i}">Remover</button></div>
          </div>`).join('') || '<p class="hint">Nenhum livro divulgado ainda.</p>'}</div>
          <button type="button" class="btn btn-primary" data-novaobra>Adicionar obra</button>
        </fieldset>

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
      } else if (t.dataset.novaobra !== undefined) {
        escolherCaminho();
      } else if (t.dataset.editobra) {
        obraDialogo(Number(t.dataset.editobra));
      } else if (t.dataset.rmobra) {
        removerObra(Number(t.dataset.rmobra));
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

  // ---------- obras: escolha de caminho + janela guiada (mesmo esquema da publicacao do Estudio) ----------
  function janela(titulo, corpo, rodape) {
    const dlg = document.createElement('dialog');
    dlg.className = 'el-dialogo';
    dlg.innerHTML = `<h2>${esc(titulo)}</h2><div class="el-dialogo-corpo"></div><div class="el-dialogo-rodape"></div>`;
    dlg.querySelector('.el-dialogo-corpo').append(...[].concat(corpo));
    dlg.querySelector('.el-dialogo-rodape').append(...[].concat(rodape));
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg); dlg.showModal();
    return dlg;
  }
  const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstChild; };
  const botao = (rotulo, classe, fn) => { const b = el(`<button type="button" class="btn ${classe}">${esc(rotulo)}</button>`); b.addEventListener('click', fn); return b; };

  async function salvarPerfil(dados) {
    const r = await api('/api/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: dados }) });
    P = r.data; editorView();
    const n = document.getElementById('saveNote'); if (n) n.innerHTML = note('Salvo. Já está na sua página pública.', true);
  }

  function escolherCaminho() {
    if (P.obras.length >= 20) {
      const d = janela('Limite atingido', el('<p>Você já tem 20 livros divulgados. Remova um para adicionar outro.</p>'), botao('Fechar', 'btn-ghost', () => d.close()));
      return;
    }
    const opcao = (titulo, texto, acao) => { const b = el(`<button type="button" class="el-opcao"><strong>${esc(titulo)}</strong><span>${esc(texto)}</span></button>`); b.addEventListener('click', acao); return b; };
    const dlg = janela('Como é esta obra?', [
      opcao('Escrever aqui no site', 'Abre o Estúdio para escrever capítulo por capítulo. Quando quiser, você publica e ela aparece na sua página.', () => { location.href = 'estudio.html#/nova/escrever'; }),
      opcao('Carregar arquivo pronto', 'Traga o livro em DOCX, TXT ou Markdown: o Estúdio divide em capítulos para você revisar e publicar.', () => { location.href = 'estudio.html#/nova/importar'; }),
      opcao('Divulgar livro de fora', 'Livro já publicado em outro lugar: título, sinopse, capa e onde comprar.', () => { dlg.close(); obraDialogo(null); }),
    ], botao('Cancelar', 'btn-ghost', () => dlg.close()));
  }

  function obraDialogo(idx) {
    const o = idx == null ? { titulo: '', genero: '', status: 'Publicado', sinopse: '', capa: '', link: '', lojas: [] } : JSON.parse(JSON.stringify(P.obras[idx]));
    o.lojas = o.lojas || [];
    const f = el(`<form class="el-form">
      <label class="fld"><span>Título</span><input name="titulo" maxlength="120" required value="${esc(o.titulo)}"></label>
      <label class="fld"><span>Gênero</span><input name="genero" maxlength="60" value="${esc(o.genero)}" placeholder="ex.: Fantasia · Livro I"></label>
      <label class="fld"><span>Situação</span><select name="status">${STATUS.map((st) => `<option${o.status === st ? ' selected' : ''}>${st}</option>`).join('')}</select></label>
      <div class="fld"><span>Classificação indicativa (faixa etária)</span><div class="faixa-op" role="radiogroup">${EL.FAIXAS.map(([v, rot]) => `<label title="${esc(rot)}"><input type="radio" name="faixa" value="${v}"${o.faixa === v ? ' checked' : ''}>${EL.faixa(v)} ${v === 'L' ? 'Livre' : v + ' anos'}</label>`).join('')}</div></div>
      <div class="fld"><span>Lançamento</span><div class="data-pub"><input name="ano" type="number" min="1900" max="2100" placeholder="Ano" aria-label="Ano de lançamento" value="${esc((o.publicado_em || '').slice(0, 4))}"><select name="mes" aria-label="Mês de lançamento"><option value="">Mês (opcional)</option>${['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'].map((m, i) => { const v = String(i + 1).padStart(2, '0'); return `<option value="${v}"${(o.publicado_em || '').slice(5) === v ? ' selected' : ''}>${m}</option>`; }).join('')}</select></div><small class="hint">Ano em que o livro saiu (o mês é opcional).</small></div>
      <label class="fld"><span>Sinopse</span><textarea name="sinopse" rows="4" maxlength="1500">${esc(o.sinopse)}</textarea><small class="hint">Aparece no seu perfil, embaixo da capa.</small></label>
      <div class="fld"><span>Capa</span><div class="el-capa"><div class="obra-mini grande"></div><div><input type="file" accept="image/jpeg,image/png,image/webp" aria-label="Enviar capa"><button type="button" class="rm" data-tirar>Tirar a capa</button><p class="hint">JPG, PNG ou WebP. A imagem é reduzida automaticamente.</p></div></div></div>
      <label class="fld"><span>Link principal (compra ou leitura)</span><input name="link" type="url" maxlength="300" value="${esc(o.link)}" placeholder="https://..."></label>
      <div class="fld"><span>Outras lojas (até 6)</span><div class="el-lojas"></div><button type="button" class="btn btn-ghost" data-loja>Adicionar loja</button></div>
      <div class="el-estado" role="status"></div>
    </form>`);
    const estado = f.querySelector('.el-estado');
    const capaBox = f.querySelector('.obra-mini');
    const desenharCapa = () => {
      capaBox.innerHTML = o.capa ? `<img src="${esc(imgUrl(o.capa))}" alt="Capa">` : '<span>Sem capa</span>';
      f.querySelector('[data-tirar]').hidden = !o.capa;
    };
    const lojasBox = f.querySelector('.el-lojas');
    const desenharLojas = () => {
      lojasBox.innerHTML = o.lojas.map((l, j) => `<div class="loja-row"><input data-lr="${j}" maxlength="40" list="lojas-sug" placeholder="Loja (ex.: Amazon)" value="${esc(l.rotulo)}"><input data-lu="${j}" type="url" maxlength="300" placeholder="https://..." value="${esc(l.url)}"><button type="button" class="rm" data-rml="${j}">Remover</button></div>`).join('');
      f.querySelector('[data-loja]').hidden = o.lojas.length >= 6;
    };
    desenharCapa(); desenharLojas();
    f.addEventListener('submit', (e) => e.preventDefault());
    f.addEventListener('input', (e) => {
      if (e.target.dataset.lr) o.lojas[Number(e.target.dataset.lr)].rotulo = e.target.value;
      if (e.target.dataset.lu) o.lojas[Number(e.target.dataset.lu)].url = e.target.value;
    });
    f.addEventListener('click', (e) => {
      if (e.target.dataset.loja !== undefined) { o.lojas.push({ rotulo: '', url: '' }); desenharLojas(); }
      else if (e.target.dataset.rml) { o.lojas.splice(Number(e.target.dataset.rml), 1); desenharLojas(); }
      else if (e.target.dataset.tirar !== undefined) { o.capa = ''; desenharCapa(); }
    });
    f.querySelector('input[type=file]').addEventListener('change', async (e) => {
      const arq = e.target.files[0]; if (!arq) return;
      estado.innerHTML = note('Enviando a capa...', true);
      try {
        const blob = await shrink(arq);
        const r = await fetch('/api/image', { method: 'POST', headers: { 'X-Requested-With': 'fetch', 'Content-Type': blob.type }, body: blob });
        const d = await r.json(); if (!r.ok) throw new Error(d.erro || 'Falha no envio.');
        o.capa = d.id; desenharCapa(); estado.innerHTML = note('Capa enviada.', true);
      } catch (err) { estado.innerHTML = note(err.message); }
      e.target.value = '';
    });
    const salvar = botao(idx == null ? 'Adicionar ao perfil' : 'Salvar', 'btn-primary', async () => {
      if (!f.titulo.value.trim()) { estado.innerHTML = note('Dê um título à obra.'); f.titulo.focus(); return; }
      if (!f.faixa.value) { estado.innerHTML = note('Escolha a classificação indicativa: para qual faixa etária o livro é recomendado.'); return; }
      const ano = f.ano.value.trim();
      if (ano && !/^(19|20)\d{2}$/.test(ano)) { estado.innerHTML = note('Ano de lançamento inválido.'); f.ano.focus(); return; }
      Object.assign(o, { titulo: f.titulo.value, genero: f.genero.value, status: f.status.value, sinopse: f.sinopse.value, link: f.link.value,
        faixa: f.faixa.value, publicado_em: ano ? (f.mes.value ? `${ano}-${f.mes.value}` : ano) : '' });
      o.lojas = o.lojas.filter((l) => l.rotulo.trim() || l.url.trim());
      const dados = JSON.parse(JSON.stringify(P));
      if (idx == null) dados.obras.push(o); else dados.obras[idx] = o;
      salvar.disabled = true; estado.innerHTML = note('Salvando...', true);
      try { await salvarPerfil(dados); dlg.close(); }
      catch (err) { estado.innerHTML = note(err.message); salvar.disabled = false; }
    });
    const dlg = janela(idx == null ? 'Divulgar livro' : 'Editar livro', f, [botao('Cancelar', 'btn-ghost', () => dlg.close()), salvar]);
    f.titulo.focus();
  }

  function removerObra(idx) {
    const o = P.obras[idx];
    const estado = el('<div class="el-estado" role="status"></div>');
    const ok = botao('Remover', 'btn-primary', async () => {
      const dados = JSON.parse(JSON.stringify(P)); dados.obras.splice(idx, 1);
      ok.disabled = true;
      try { await salvarPerfil(dados); dlg.close(); } catch (err) { estado.innerHTML = note(err.message); ok.disabled = false; }
    });
    const dlg = janela('Remover este livro?', [el(`<p>“${esc(o.titulo || 'Sem título')}” sai da sua página pública, junto com as avaliações dele.</p>`), estado], [botao('Cancelar', 'btn-ghost', () => dlg.close()), ok]);
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
    if (h === '#nova-obra') return escolherCaminho();
    if (h.indexOf('#obra-') === 0) {
      const idx = P.obras.findIndex(o => o.id === h.slice(6));
      if (idx >= 0) obraDialogo(idx);
    }
  }

  async function load(){
    try {
      const me = await api('/api/me');
      slug = me.slug; isMod = !!me.mod;
      if (me.role === 'leitor') return readerView(me);
      const p = await api('/api/profile/' + slug);
      P = p.data; editorView(); openFromHash();
    } catch (e) {
      // link de convite (conta.html#convite=CODIGO): abre o cadastro de autor com o codigo preenchido.
      // O codigo fica no fragmento (#), que o navegador nao envia ao servidor.
      const conv = /^#convite=([A-Z0-9-]{5,40})$/i.exec(location.hash);
      if (!conv) return authView('login');
      history.replaceState(null, '', location.pathname);
      authView('register');
      document.querySelector('#authForm input[name=convite]').value = conv[1].toUpperCase();
      document.querySelector('#authForm input[name=nome]').focus();
    }
  }
  load();
})();
