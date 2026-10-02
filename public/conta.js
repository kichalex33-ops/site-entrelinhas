(function(){
  'use strict';
  const { esc, imgUrl, api } = EL;
  const app = document.getElementById('app');
  const subtitle = document.getElementById('subtitle');
  const STATUS = ['Publicado', 'Em desenvolvimento', 'Em escrita', 'Revisão', 'Em breve'];
  const FUNDOS = [['preto', 'Preto'], ['azul', 'Azul noite'], ['vinho', 'Vinho'], ['verde', 'Verde escuro'], ['grafite', 'Grafite']];
  let P = null, slug = '';

  const field = (label, html) => `<label class="fld"><span>${label}</span>${html}</label>`;
  const input = (path, val, extra = '') => `<input data-k="${path}" value="${esc(val)}" ${extra}>`;
  const area = (path, val, rows = 4, max = 4000) => `<textarea data-k="${path}" rows="${rows}" maxlength="${max}">${esc(val)}</textarea>`;
  const note = (t, ok) => `<p class="note ${ok ? 'ok' : 'err'}" role="status">${esc(t)}</p>`;

  // ---------- login / cadastro ----------
  function authView(mode){
    subtitle.textContent = 'Entre para editar a sua página pública.';
    app.innerHTML = `
      <div class="auth-box">
        <div class="auth-tabs">
          <button class="${mode === 'login' ? 'on' : ''}" data-mode="login">Entrar</button>
          <button class="${mode === 'register' ? 'on' : ''}" data-mode="register">Criar conta</button>
        </div>
        <form id="authForm" autocomplete="on">
          ${mode === 'register' ? field('Código de convite', '<input name="convite" required autocomplete="off">') + field('Seu nome (aparece na página)', '<input name="nome" maxlength="80" autocomplete="name">') : ''}
          ${field('E-mail', '<input name="email" type="email" required autocomplete="email">')}
          ${field('Senha' + (mode === 'register' ? ' (mínimo 10 caracteres)' : ''), `<input name="senha" type="password" required minlength="${mode === 'register' ? 10 : 1}" autocomplete="${mode === 'register' ? 'new-password' : 'current-password'}">`)}
          <button class="btn btn-primary" type="submit">${mode === 'login' ? 'Entrar' : 'Criar conta'}</button>
          <div id="authNote"></div>
        </form>
        <p class="hint">${mode === 'register'
          ? 'O cadastro é fechado: precisa de um código de convite do coletivo. O e-mail serve só para entrar e nunca aparece no site.'
          : 'Esqueceu a senha? Peça ao coletivo para redefinir.'}</p>
      </div>`;
    app.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => authView(b.dataset.mode)));
    document.getElementById('authForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      const btn = e.target.querySelector('button[type=submit]'); btn.disabled = true;
      try {
        await api('/api/' + mode, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f) });
        await load();
      } catch (err) {
        document.getElementById('authNote').innerHTML = note(err.message);
        btn.disabled = false;
      }
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
        <button class="btn btn-ghost" id="logout" type="button">Sair</button>
      </div>
      <form id="ed" class="ed-form" autocomplete="off">
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
          field('Link (compra ou leitura)', input(`obras.${i}.link`, o.link, 'maxlength="300" type="url"')) +
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
        const blank = { links: { rotulo: '', url: '' }, obras: { titulo: '', genero: '', status: 'Publicado', sinopse: '', capa: '', link: '' }, secoes: { titulo: '', texto: '' } }[t.dataset.add];
        const max = { links: 8, obras: 20, secoes: 8 }[t.dataset.add];
        if (P[t.dataset.add].length >= max) return alert('Limite atingido.');
        P[t.dataset.add].push(blank); editorView();
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

  async function load(){
    try {
      const me = await api('/api/me');
      slug = me.slug;
      const p = await api('/api/profile/' + slug);
      P = p.data; editorView();
    } catch (e) { authView('login'); }
  }
  load();
})();
