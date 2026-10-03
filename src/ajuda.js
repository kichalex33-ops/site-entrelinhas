// Ajuda entre autores (aba Servicos): pedidos de leitura beta e, aos poucos, os outros servicos.
// So autores participam (pedem e ajudam). O acesso ao original so aparece para quem o dono aceitou.
// Ao marcar a ajuda como concluida, quem ajudou ganha o selo do servico no perfil (sem nota, sem ranking).
export const SERVICOS = {
  beta: { nome: 'Leitura Beta', selo: 'Leitor beta', aberto: true },
  critica: { nome: 'Leitura crítica e revisão', selo: 'Olhar crítico', aberto: false },
  divulgacao: { nome: 'Divulgação', selo: 'Divulgador', aberto: false },
  capa: { nome: 'Capa e diagramação', selo: '', aberto: false },
};
const LIM = { abertosPorAutor: 3, ofertasPorDia: 10, vagas: 5 };

const nomeSql = "COALESCE(json_extract(p.data, '$.nome'), u.slug)";

// GET /api/ajuda (autor): pedidos abertos dos outros, os meus (com ofertas) e as minhas ajudas
export async function listarAjuda(env, user, h) {
  const abertos = await env.DB.prepare(
    `SELECT r.id, r.tipo, r.titulo, r.genero, r.descricao, r.tamanho, r.retorno, r.prazo, r.vagas, r.created_at, u.slug AS autor_slug, ${nomeSql} AS autor_nome,
       (SELECT COUNT(*) FROM help_offers o WHERE o.request_id = r.id AND o.status IN ('aceito', 'concluido')) AS aceitos,
       (SELECT status FROM help_offers o WHERE o.request_id = r.id AND o.user_id = ?1) AS minha
     FROM help_requests r JOIN users u ON u.id = r.user_id LEFT JOIN profiles p ON p.user_id = u.id
     WHERE r.status = 'aberto' AND r.user_id != ?1 ORDER BY r.created_at DESC LIMIT 100`
  ).bind(user.id).all();

  const meus = (await env.DB.prepare('SELECT * FROM help_requests WHERE user_id = ? ORDER BY status = \'aberto\' DESC, created_at DESC LIMIT 50').bind(user.id).all()).results;
  const ofertas = meus.length ? (await env.DB.prepare(
    `SELECT o.request_id, o.user_id, o.msg, o.status, o.created_at, u.slug, ${nomeSql} AS nome
     FROM help_offers o JOIN users u ON u.id = o.user_id LEFT JOIN profiles p ON p.user_id = u.id
     WHERE o.request_id IN (SELECT id FROM help_requests WHERE user_id = ?) ORDER BY o.created_at`
  ).bind(user.id).all()).results : [];

  const ajudas = (await env.DB.prepare(
    `SELECT r.id, r.tipo, r.titulo, r.status AS pedido_status, o.status, o.msg, u.slug AS autor_slug, ${nomeSql} AS autor_nome,
       CASE WHEN o.status IN ('aceito', 'concluido') THEN r.acesso ELSE '' END AS acesso
     FROM help_offers o JOIN help_requests r ON r.id = o.request_id JOIN users u ON u.id = r.user_id LEFT JOIN profiles p ON p.user_id = u.id
     WHERE o.user_id = ? ORDER BY o.updated_at DESC LIMIT 50`
  ).bind(user.id).all()).results;

  return h.json({
    servicos: SERVICOS,
    abertos: abertos.results,
    meus: meus.map((r) => ({ ...r, ofertas: ofertas.filter((o) => o.request_id === r.id) })),
    ajudas,
  });
}

// POST /api/ajuda (autor): novo pedido
export async function criarPedido(env, req, user, h) {
  const b = await h.body(req);
  if (!b) return h.fail('Requisição inválida.');
  const s = SERVICOS[b.tipo];
  if (!s || !s.aberto) return h.fail('Este serviço ainda não está aberto.');
  const titulo = h.str(b.titulo, 120), descricao = h.str(b.descricao, 2000), retorno = h.str(b.retorno, 1000), acesso = h.str(b.acesso, 1000);
  if (!titulo) return h.fail('Dê um título ao pedido (normalmente o nome do livro).');
  if (descricao.length < 20) return h.fail('Conte do que se trata o texto (pelo menos 20 caracteres).');
  if (!acesso) return h.fail('Diga como quem for ajudar chega ao original (link, e-mail...). Só quem você aceitar vê isso.');
  const vagas = Math.min(LIM.vagas, Math.max(1, Math.floor(Number(b.vagas) || 1)));
  const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM help_requests WHERE user_id = ? AND status = 'aberto'").bind(user.id).first();
  if (n.n >= LIM.abertosPorAutor) return h.fail(`Você já tem ${LIM.abertosPorAutor} pedidos abertos. Feche um para abrir outro.`, 409);
  await env.DB.prepare(
    'INSERT INTO help_requests (user_id, tipo, titulo, genero, descricao, tamanho, retorno, prazo, acesso, vagas, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(user.id, b.tipo, titulo, h.str(b.genero, 80), descricao, h.str(b.tamanho, 120), retorno, h.str(b.prazo, 80), acesso, vagas, h.now()).run();
  return listarAjuda(env, user, h);
}

// POST /api/ajuda/:id/fechar (dono) e /reabrir
export async function fecharPedido(env, user, id, abrir, h) {
  const r = await env.DB.prepare('UPDATE help_requests SET status = ?, closed_at = ? WHERE id = ? AND user_id = ?')
    .bind(abrir ? 'aberto' : 'fechado', abrir ? null : h.now(), id, user.id).run();
  if (!r.meta || r.meta.changes !== 1) return h.fail('Pedido não encontrado.', 404);
  return listarAjuda(env, user, h);
}

// POST /api/ajuda/:id/oferta (outro autor): "quero ajudar"; DELETE desiste (antes de concluir)
export async function ofertar(env, req, user, id, h) {
  const r = await env.DB.prepare("SELECT user_id FROM help_requests WHERE id = ? AND status = 'aberto'").bind(id).first();
  if (!r) return h.fail('Pedido não encontrado ou já fechado.', 404);
  if (r.user_id === user.id) return h.fail('Este pedido é seu.', 403);
  const hoje = await env.DB.prepare('SELECT COUNT(*) AS n FROM help_offers WHERE user_id = ? AND created_at > ?').bind(user.id, h.now() - 86400).first();
  if (hoje.n >= LIM.ofertasPorDia) return h.fail('Limite de ofertas por hoje atingido.', 429);
  const b = (await h.body(req)) || {};
  const ins = await env.DB.prepare('INSERT INTO help_offers (request_id, user_id, msg, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING')
    .bind(id, user.id, h.str(b.msg, 500), h.now(), h.now()).run();
  if (!ins.meta || ins.meta.changes !== 1) return h.fail('Você já se ofereceu para este pedido.', 409);
  return listarAjuda(env, user, h);
}

export async function desistir(env, user, id, h) {
  const r = await env.DB.prepare("DELETE FROM help_offers WHERE request_id = ? AND user_id = ? AND status != 'concluido'").bind(id, user.id).run();
  if (!r.meta || r.meta.changes !== 1) return h.fail('Oferta não encontrada.', 404);
  return listarAjuda(env, user, h);
}

// POST /api/ajuda/:id/oferta/:userId { acao: aceitar | recusar | concluir } (dono do pedido)
export async function decidirOferta(env, req, user, id, ajudante, h) {
  const r = await env.DB.prepare('SELECT tipo, vagas FROM help_requests WHERE id = ? AND user_id = ?').bind(id, user.id).first();
  if (!r) return h.fail('Pedido não encontrado.', 404);
  const o = await env.DB.prepare('SELECT status FROM help_offers WHERE request_id = ? AND user_id = ?').bind(id, ajudante).first();
  if (!o) return h.fail('Oferta não encontrada.', 404);
  const b = (await h.body(req)) || {};
  const de = { aceitar: ['oferta', 'recusado'], recusar: ['oferta', 'aceito'], concluir: ['aceito'] }[b.acao];
  if (!de) return h.fail('Ação inválida.');
  if (!de.includes(o.status)) return h.fail(b.acao === 'concluir' ? 'Só dá para concluir uma ajuda aceita.' : 'Esta oferta não pode mudar assim.', 409);
  if (b.acao === 'aceitar') {
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM help_offers WHERE request_id = ? AND status IN ('aceito', 'concluido')").bind(id).first();
    if (n.n >= r.vagas) return h.fail(`As ${r.vagas} vaga(s) deste pedido já foram preenchidas.`, 409);
  }
  const novo = { aceitar: 'aceito', recusar: 'recusado', concluir: 'concluido' }[b.acao];
  await env.DB.prepare('UPDATE help_offers SET status = ?, updated_at = ? WHERE request_id = ? AND user_id = ?').bind(novo, h.now(), id, ajudante).run();
  const selo = SERVICOS[r.tipo] && SERVICOS[r.tipo].selo;
  if (novo === 'concluido' && selo) {
    // selo de participacao: um por servico, nao acumula contagem
    await env.DB.prepare(
      "UPDATE profiles SET badges = json_insert(badges, '$[#]', ?1) WHERE user_id = ?2 AND NOT EXISTS (SELECT 1 FROM json_each(profiles.badges) WHERE value = ?1)"
    ).bind(selo, ajudante).run();
  }
  return listarAjuda(env, user, h);
}
