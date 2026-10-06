// Caixa do contato@entrelinhasbr.com.br, lida pelos moderadores no painel (cada um com a propria conta).
// Caminho: Cloudflare Email Routing (regra contato@ -> este Worker) -> email() -> copia para CONTATO_COPIA
// (endereco verificado no Email Routing) e mensagem guardada no D1. Configuracao no painel do Cloudflare: README.
import PostalMime from 'postal-mime';

const LIMITE_TEXTO = 20000;
const MANTER_DIAS = 365;

// email(): primeiro a copia (assim a mensagem nunca se perde, mesmo se a leitura falhar), depois o banco.
export async function receberEmail(message, env, agora) {
  let copiou = false, guardou = false, erro = null;
  if (env.CONTATO_COPIA) {
    try { await message.forward(env.CONTATO_COPIA); copiou = true; } catch (e) { erro = e; }
  }
  try {
    const bruto = await new Response(message.raw).arrayBuffer(); // o stream so pode ser lido uma vez
    const m = await PostalMime.parse(bruto);
    const texto = (m.text || textoDoHtml(m.html) || '').trim();
    await env.DB.prepare(
      'INSERT INTO contato_mensagens (remetente, nome, responder_para, assunto, texto, anexos, message_id, tamanho, recebida_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(
      String(message.from || '').slice(0, 254),
      String((m.from && m.from.name) || '').slice(0, 120),
      String((m.replyTo && m.replyTo[0] && m.replyTo[0].address) || '').slice(0, 254),
      String(m.subject || '').slice(0, 300),
      texto.length > LIMITE_TEXTO ? texto.slice(0, LIMITE_TEXTO) + '\n\n[mensagem cortada: o texto completo está na cópia do Proton]' : texto,
      JSON.stringify((m.attachments || []).map((a) => String(a.filename || 'anexo').slice(0, 120)).slice(0, 30)),
      String(m.messageId || '').slice(0, 300),
      Number(message.rawSize) || bruto.byteLength,
      agora,
    ).run();
    guardou = true;
  } catch (e) { erro = erro || e; }
  // se nada deu certo, falha alto: o Email Routing devolve o erro e nao some com a mensagem em silencio
  if (!copiou && !guardou) throw erro || new Error('Mensagem nao entregue');
}

// HTML sem tags, para quem manda e-mail so em HTML
function textoDoHtml(html) {
  if (!html) return '';
  return html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').replace(/<br\s*\/?>|<\/p>|<\/div>/gi, '\n').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/\n{3,}/g, '\n\n');
}

// tarefa diaria: mensagens com mais de 1 ano saem (Politica de Privacidade)
export const limparMensagensAntigas = (env, agora) => env.DB.prepare('DELETE FROM contato_mensagens WHERE recebida_em < ?').bind(agora - MANTER_DIAS * 86400).run();

// GET /api/admin/mensagens[?todas=1] (moderadores)
export async function listarMensagens(env, url, h) {
  const todas = url.searchParams.get('todas') === '1';
  const r = await env.DB.prepare(
    `SELECT c.id, c.remetente, c.nome, c.responder_para, c.assunto, c.texto, c.anexos, c.status, c.recebida_em, c.lida_em,
       COALESCE(NULLIF(json_extract(p.data, '$.nome'), ''), NULLIF(u.nome, ''), u.slug) AS lida_por
     FROM contato_mensagens c LEFT JOIN users u ON u.id = c.lida_por LEFT JOIN profiles p ON p.user_id = u.id
     ${todas ? '' : "WHERE c.status != 'arquivada'"} ORDER BY c.status = 'nova' DESC, c.recebida_em DESC LIMIT 200`
  ).all();
  return h.json(r.results.map((c) => ({ ...c, anexos: JSON.parse(c.anexos || '[]') })));
}

// POST /api/admin/mensagens/:id { status: 'lida' | 'arquivada' | 'nova' }
export async function marcarMensagem(env, req, user, id, h) {
  const b = await h.body(req);
  if (!b || !['lida', 'arquivada', 'nova'].includes(b.status)) return h.fail('Estado inválido.');
  const r = await env.DB.prepare('UPDATE contato_mensagens SET status = ?, lida_por = ?, lida_em = ? WHERE id = ?')
    .bind(b.status, b.status === 'nova' ? null : user.id, b.status === 'nova' ? null : h.now(), id).run();
  if (!r.meta || r.meta.changes !== 1) return h.fail('Mensagem não encontrada.', 404);
  return h.json({ ok: true });
}
