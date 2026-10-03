// Denuncias de livros: qualquer conta logada denuncia (uma vez por livro); moderadores analisam no painel.
// O autor ve que ha denuncias em analise e os motivos, nunca quem denunciou.
export const MOTIVOS_LIVRO = {
  plagio: 'Plágio ou cópia de outra obra',
  pirataria: 'Pirataria ou violação de direitos autorais',
  ia: 'Texto gerado por IA sem aviso',
  classificacao: 'Classificação etária errada',
  ofensivo: 'Conteúdo ofensivo ou ilegal',
  spam: 'Spam ou propaganda',
  outro: 'Outro motivo',
};
const PRECISA_DETALHE = ['plagio', 'pirataria', 'outro'];
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
  return h.json(r.results.map((d) => ({ ...d, rotulo: MOTIVOS_LIVRO[d.motivo] || d.motivo })));
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
