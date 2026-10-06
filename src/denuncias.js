// Denuncias de livros: qualquer conta logada denuncia (uma vez por livro); moderadores analisam no painel.
// O autor ve que ha denuncias em analise e os motivos, nunca quem denunciou.
export const MOTIVOS_LIVRO = {
  plagio: 'Plágio ou cópia de outra obra',
  pirataria: 'Pirataria ou violação de direitos autorais',
  sem_autorizacao: 'Publicação sem autorização do titular dos direitos',
  ia: 'Texto gerado por IA sem aviso',
  classificacao: 'Classificação etária errada',
  ofensivo: 'Conteúdo ofensivo ou ilegal',
  spam: 'Spam ou propaganda',
  outro: 'Outro motivo',
};
const PRECISA_DETALHE = ['plagio', 'pirataria', 'sem_autorizacao', 'outro'];
const POR_DIA = 10;

// POST /api/livro/:autor/:obra/denuncia
export async function denunciarLivro(env, req, user, autor, obraId, h) {
  const b = await h.body(req);
  if (!b) return h.fail('Requisição inválida.');
  if (!MOTIVOS_LIVRO[b.motivo]) return h.fail('Escolha o motivo da denúncia.');
  const detalhe = h.str(b.detalhe, 1000), link = h.str(b.link, 300);
  if (PRECISA_DETALHE.includes(b.motivo) && detalhe.length < 10) return h.fail('Descreva o problema (pelo menos 10 caracteres): o que foi copiado, de onde, como você sabe.');
  if (link && !h.isUrl(link)) return h.fail('O link do original precisa começar com https://');
  if (user.slug === autor) return h.fail('Você não pode denunciar o seu próprio livro.', 403);
  if (!(await h.obraExists(autor, obraId))) return h.fail('Livro não encontrado.', 404);
  const hoje = await env.DB.prepare('SELECT COUNT(*) AS n FROM book_reports WHERE user_id = ? AND created_at > ?').bind(user.id, h.now() - 86400).first();
  if (hoje.n >= POR_DIA) return h.fail('Você atingiu o limite de denúncias por hoje.', 429);
  const r = await env.DB.prepare(
    'INSERT INTO book_reports (autor_slug, obra_id, user_id, motivo, detalhe, link, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(obra_id, user_id) DO NOTHING'
  ).bind(autor, obraId, user.id, b.motivo, detalhe, link, h.now()).run();
  if (!r.meta || r.meta.changes !== 1) return h.fail('Você já denunciou este livro. A moderação vai analisar.', 409);
  return h.json({ ok: true });
}

// para a pagina do livro (so o dono recebe): motivos em analise, sem identificar ninguem
export async function denunciasAbertas(env, obraId) {
  const r = await env.DB.prepare("SELECT motivo, COUNT(*) AS n FROM book_reports WHERE obra_id = ? AND status = 'aberta' GROUP BY motivo").bind(obraId).all();
  return r.results.map((x) => ({ motivo: x.motivo, rotulo: MOTIVOS_LIVRO[x.motivo] || x.motivo, n: x.n }));
}

// GET /api/admin/denuncias-livros (moderadores): abertas primeiro, agrupadas por livro no navegador
export async function listarDenunciasLivros(env, url, h) {
  const todas = url.searchParams.get('todas') === '1';
  const r = await env.DB.prepare(
    `SELECT d.id, d.autor_slug, d.obra_id, d.motivo, d.detalhe, d.link, d.status, d.nota, d.created_at, d.resolved_at,
       COALESCE(NULLIF(u.nome, ''), u.slug) AS quem, COALESCE(NULLIF(m.nome, ''), m.slug) AS moderador
     FROM book_reports d JOIN users u ON u.id = d.user_id LEFT JOIN users m ON m.id = d.resolved_by
     ${todas ? '' : "WHERE d.status = 'aberta'"} ORDER BY d.status = 'aberta' DESC, d.created_at DESC LIMIT 100`
  ).all();
  const titulos = await titulosDosLivros(env, r.results);
  return h.json(r.results.map((d) => ({ ...d, rotulo: MOTIVOS_LIVRO[d.motivo] || d.motivo, titulo: titulos.get(d.obra_id) || '' })));
}

// titulo de cada livro denunciado (livro divulgado no perfil ou obra do Estudio), para o moderador saber qual e
async function titulosDosLivros(env, linhas) {
  const titulos = new Map();
  for (const slug of new Set(linhas.map((d) => d.autor_slug))) {
    const p = await env.DB.prepare('SELECT data FROM profiles WHERE slug = ?').bind(slug).first();
    try { for (const o of JSON.parse(p ? p.data : '{}').obras || []) if (o.id) titulos.set(o.id, o.titulo || ''); } catch { /* perfil invalido */ }
  }
  for (const id of new Set(linhas.map((d) => d.obra_id))) {
    if (titulos.has(id)) continue;
    const w = await env.DB.prepare('SELECT title, pub_meta FROM studio_works WHERE id = ?').bind(id).first();
    if (w) { let t = w.title; try { t = JSON.parse(w.pub_meta || '{}').titulo || t; } catch { /* sem meta */ } titulos.set(id, t); }
  }
  return titulos;
}

// ---------- denuncias de avaliacoes (moderadores) ----------
// Uma linha por avaliacao denunciada, com os motivos e quantas pessoas denunciaram. Quem escreveu a avaliacao
// nao fica sabendo quem denunciou; o moderador ve, para poder notar denuncias de ma-fe.
export const MOTIVOS_AVALIACAO = { spoiler: 'Spoiler sem aviso', ofensivo: 'Ofensiva', spam: 'Spam' };

// GET /api/admin/denuncias-avaliacoes[?todas=1]
export async function listarDenunciasAvaliacoes(env, url, h) {
  const todas = url.searchParams.get('todas') === '1';
  const r = await env.DB.prepare(
    `SELECT v.id, v.author_slug, v.obra_id, v.nota, v.texto, v.spoiler, v.hidden, v.created_at,
       COALESCE(NULLIF(u.nome, ''), u.slug) AS escreveu,
       d.motivo, d.status, d.created_at AS denunciada_em, d.decided_at, COALESCE(NULLIF(q.nome, ''), q.slug) AS quem,
       COALESCE(NULLIF(m.nome, ''), m.slug) AS moderador
     FROM review_reports d JOIN reviews v ON v.id = d.review_id JOIN users u ON u.id = v.user_id JOIN users q ON q.id = d.user_id
     LEFT JOIN users m ON m.id = d.decided_by
     ${todas ? '' : "WHERE d.status = 'aberta'"} ORDER BY d.status = 'aberta' DESC, d.created_at DESC LIMIT 300`
  ).all();
  const porAvaliacao = new Map();
  for (const x of r.results) {
    if (!porAvaliacao.has(x.id)) {
      porAvaliacao.set(x.id, { id: x.id, autor_slug: x.author_slug, obra_id: x.obra_id, nota: x.nota, texto: x.texto, spoiler: !!x.spoiler,
        oculta: !!x.hidden, escreveu: x.escreveu, em: x.created_at, denuncias: [] });
    }
    porAvaliacao.get(x.id).denuncias.push({ motivo: x.motivo, rotulo: MOTIVOS_AVALIACAO[x.motivo] || x.motivo, quem: x.quem, em: x.denunciada_em, status: x.status, moderador: x.moderador, decidida_em: x.decided_at });
  }
  const lista = [...porAvaliacao.values()];
  const titulos = await titulosDosLivros(env, lista.map((a) => ({ autor_slug: a.autor_slug, obra_id: a.obra_id })));
  for (const a of lista) a.titulo = titulos.get(a.obra_id) || '';
  return h.json(lista.slice(0, 100));
}

// POST /api/admin/denuncias-avaliacoes/:id { acao: 'ocultar' | 'manter' }: decide todas as denuncias abertas da avaliacao
export async function decidirDenunciaAvaliacao(env, req, user, id, h) {
  const b = await h.body(req);
  const acao = b && (b.acao === 'ocultar' || b.acao === 'manter') ? b.acao : null;
  if (!acao) return h.fail('Ação inválida.');
  const v = await env.DB.prepare('SELECT user_id FROM reviews WHERE id = ?').bind(id).first();
  if (!v) return h.fail('Avaliação não encontrada.', 404);
  if (v.user_id === user.id) return h.fail('Outro moderador precisa decidir sobre a sua própria avaliação.', 403);
  await env.DB.batch([
    env.DB.prepare('UPDATE reviews SET hidden = ? WHERE id = ?').bind(acao === 'ocultar' ? 1 : 0, id),
    env.DB.prepare("UPDATE review_reports SET status = ?, decided_by = ?, decided_at = ? WHERE review_id = ? AND status = 'aberta'")
      .bind(acao === 'ocultar' ? 'ocultada' : 'mantida', user.id, h.now(), id),
  ]);
  return h.json({ ok: true, oculta: acao === 'ocultar' });
}

// POST /api/admin/denuncias-livros/:id  { acao: 'resolver' | 'arquivar', nota }
export async function decidirDenunciaLivro(env, req, user, id, h) {
  const b = await h.body(req);
  const status = b && b.acao === 'resolver' ? 'resolvida' : b && b.acao === 'arquivar' ? 'arquivada' : null;
  if (!status) return h.fail('Ação inválida.');
  const r = await env.DB.prepare('UPDATE book_reports SET status = ?, nota = ?, resolved_by = ?, resolved_at = ? WHERE id = ?')
    .bind(status, h.str(b.nota, 500), user.id, h.now(), id).run();
  if (!r.meta || r.meta.changes !== 1) return h.fail('Denúncia não encontrada.', 404);
  return h.json({ ok: true, status });
}
