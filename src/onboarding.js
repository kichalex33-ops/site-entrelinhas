// Primeiros passos (Minha conta): uma lista curta, marcada sozinha pelos dados reais da conta. Sem tour nem janela.
// Autor: perfil -> obra -> manuscrito -> capa/sinopse -> publicar. Leitor: perfil (opcional), estante, seguir,
// favoritar, avaliar. Some quando estiver feita (autor: os 5 passos; leitor: atividade suficiente).
// Dispensar/minimizar fica no navegador (conta.js); nada aqui bloqueia o uso do site.
const conta = async (env, sql, ...args) => ((await env.DB.prepare(sql).bind(...args).first()) || { n: 0 }).n > 0;

async function passosDoAutor(env, user) {
  const p = await env.DB.prepare('SELECT data FROM profiles WHERE user_id = ?').bind(user.id).first();
  let d = {};
  try { d = JSON.parse(p ? p.data : '{}') || {}; } catch { /* perfil invalido */ }
  const obras = "FROM studio_works w WHERE w.user_id = ? AND w.deleted_at IS NULL";
  return [
    { chave: 'perfil', rotulo: 'Complete seu perfil (foto e uma frase ou biografia)', link: 'conta.html',
      feito: !!d.retrato && !!(String(d.frase || '').trim() || String(d.bio || '').trim()) },
    { chave: 'obra', rotulo: 'Crie sua primeira obra no Estúdio', link: 'estudio.html',
      feito: await conta(env, `SELECT COUNT(*) AS n ${obras}`, user.id) },
    { chave: 'manuscrito', rotulo: 'Escreva ou importe o manuscrito (um capítulo já conta)', link: 'estudio.html',
      feito: await conta(env, `SELECT COUNT(*) AS n FROM studio_docs d JOIN studio_works w ON w.id = d.work_id
        WHERE w.user_id = ? AND w.deleted_at IS NULL AND d.deleted_at IS NULL AND d.doc_type IN ('capitulo', 'cena') AND d.words > 0`, user.id) },
    { chave: 'dados', rotulo: 'Prepare capa, sinopse e gênero da obra', link: 'estudio.html',
      feito: await conta(env, `SELECT COUNT(*) AS n ${obras} AND TRIM(COALESCE(json_extract(w.meta, '$.sinopse'), '')) != ''
        AND (COALESCE(json_extract(w.meta, '$.capa'), '') != '' OR COALESCE(json_extract(w.meta, '$.genero'), '') != '')`, user.id) },
    { chave: 'publicar', rotulo: 'Publique (pelo botão Publicar, no Estúdio)', link: 'estudio.html',
      feito: await conta(env, `SELECT COUNT(*) AS n ${obras} AND w.published_at IS NOT NULL`, user.id) },
  ];
}

async function passosDoLeitor(env, user) {
  const u = await env.DB.prepare('SELECT foto, bio FROM users WHERE id = ?').bind(user.id).first();
  return [
    { chave: 'perfil', rotulo: 'Se quiser, ponha foto ou uma bio no seu perfil', link: 'conta.html', opcional: true, feito: !!(u && (u.foto || String(u.bio || '').trim())) },
    { chave: 'estante', rotulo: 'Explore a Biblioteca e ponha um livro na estante (Quero ler, Lendo...)', link: 'index.html#biblioteca',
      feito: await conta(env, 'SELECT COUNT(*) AS n FROM reader_list_items i JOIN reader_lists l ON l.id = i.list_id WHERE l.user_id = ?', user.id) },
    { chave: 'seguir', rotulo: 'Siga um autor para acompanhar o que ele publica', link: 'autores.html',
      feito: await conta(env, "SELECT COUNT(*) AS n FROM follows f JOIN users u ON u.slug = f.seguido_slug WHERE f.user_id = ? AND u.role = 'autor'", user.id) },
    { chave: 'favoritar', rotulo: 'Favorite um livro de que gostou', link: 'index.html#biblioteca',
      feito: await conta(env, 'SELECT COUNT(*) AS n FROM book_favorites WHERE user_id = ?', user.id) },
    { chave: 'avaliar', rotulo: 'Depois de ler, deixe uma avaliação', link: 'index.html#biblioteca',
      feito: await conta(env, 'SELECT COUNT(*) AS n FROM reviews WHERE user_id = ?', user.id) },
  ];
}

// GET /api/onboarding
export async function primeirosPassos(env, user, h) {
  const autor = user.role === 'autor';
  const passos = autor ? await passosDoAutor(env, user) : await passosDoLeitor(env, user);
  const feito = (k) => passos.find((p) => p.chave === k).feito;
  // leitor: atividade suficiente = estante + seguir + (favoritar ou avaliar); o perfil e opcional
  const completo = autor ? passos.every((p) => p.feito) : feito('estante') && feito('seguir') && (feito('favoritar') || feito('avaliar'));
  return h.json({ papel: autor ? 'autor' : 'leitor', completo, passos });
}
