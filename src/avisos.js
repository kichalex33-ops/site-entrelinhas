// Editais e eventos para autores (aba Comunidade). Uma tarefa diaria busca feeds publicos, guarda so titulo, fonte, link e data,
// e um moderador aprova cada item antes de aparecer. O texto das materias nunca e copiado: o leitor clica e vai para a fonte.
const gnews = (q) => `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=pt-BR&gl=BR&ceid=BR:pt-419`;
export const FONTES = {
  // o feed da RelevO mistura cronicas pessoais com o boletim: so as edicoes "Latitudes" (editais, concursos, eventos)
  relevo: { nome: 'Jornal RelevO', url: 'https://jornalrelevo.substack.com/feed', max: 6, titulo: /latitudes/i },
  editais: { nome: '', url: gnews('(edital OR concurso OR prêmio) (literário OR literatura OR escritores) inscrições when:14d'), max: 15 },
  eventos: { nome: '', url: gnews('(bienal OR "feira do livro" OR "feira literária" OR festival literário) when:14d'), max: 10 },
};
const LIM = { titulo: 200, link: 500, pendentes: 150, porColeta: 40, idadeMaxDias: 45, resposta: 600000 };

const decodificar = (s) => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]*>/g, '') // tags de verdade saem antes de decodificar: "&lt;abertas&gt;" continua texto
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&amp;/g, '&')
  .replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
const campo = (bloco, tag) => { const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i').exec(bloco); return m ? decodificar(m[1]) : ''; };

// RSS 2.0 minimo (o que Substack e Google Noticias entregam). Sem dependencia: so <item>, <title>, <link>, <pubDate>, <source>.
export function lerFeed(xml) {
  const itens = [];
  for (const m of String(xml).matchAll(/<item[\s>]([\s\S]*?)<\/item>/gi)) {
    const b = m[1];
    const link = campo(b, 'link');
    if (!/^https?:\/\/[^\s"'<>]{4,}$/i.test(link) || link.length > LIM.link) continue;
    let titulo = campo(b, 'title');
    const fonte = campo(b, 'source');
    if (fonte && titulo.endsWith(' - ' + fonte)) titulo = titulo.slice(0, -fonte.length - 3).trim(); // o Google Noticias poe o veiculo no fim do titulo
    if (titulo.length < 8) continue;
    const t = Date.parse(campo(b, 'pubDate'));
    itens.push({ titulo: titulo.slice(0, LIM.titulo), link, fonte: fonte.slice(0, 80), em: Number.isFinite(t) ? Math.floor(t / 1000) : 0 });
  }
  return itens;
}

// Busca todas as fontes e grava o que e novo como "pendente". Falha de uma fonte nao derruba as outras.
export async function coletarAvisos(env, agora, buscar = fetch) {
  const resumo = { novos: 0, erros: [] };
  const pend = await env.DB.prepare("SELECT COUNT(*) AS n FROM avisos WHERE status = 'pendente'").first();
  let folga = LIM.pendentes - pend.n;
  for (const [chave, f] of Object.entries(FONTES)) {
    if (folga <= 0) break;
    try {
      const r = await buscar(f.url, { headers: { 'User-Agent': 'Entrelinhas/1.0 (+https://entrelinhasbr.com.br)', Accept: 'application/rss+xml, application/xml' }, signal: AbortSignal.timeout(10000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const xml = (await r.text()).slice(0, LIM.resposta);
      const recentes = lerFeed(xml)
        .filter((i) => !f.titulo || f.titulo.test(i.titulo))
        .filter((i) => !i.em || agora - i.em < LIM.idadeMaxDias * 86400)
        .sort((a, b) => b.em - a.em).slice(0, f.max);
      for (const i of recentes) {
        if (resumo.novos >= LIM.porColeta || folga <= 0) break;
        const r2 = await env.DB.prepare('INSERT OR IGNORE INTO avisos (fonte, feed, titulo, link, publicado_em, coletado_em) VALUES (?, ?, ?, ?, ?, ?)')
          .bind(f.nome || i.fonte || 'Notícia', chave, i.titulo, i.link, i.em || agora, agora).run();
        if (r2.meta && r2.meta.changes === 1) { resumo.novos++; folga--; }
      }
    } catch (e) { resumo.erros.push(`${chave}: ${e.message}`); }
  }
  return resumo;
}

// recusados e pendentes velhos saem depois de 60 dias (os aprovados ficam)
export async function limparAvisos(env, agora) {
  await env.DB.prepare("DELETE FROM avisos WHERE status != 'aprovado' AND coletado_em < ?").bind(agora - 60 * 86400).run();
}

const saida = (r, mod) => ({
  id: r.id, fonte: r.fonte, titulo: r.titulo, link: r.link, em: r.publicado_em,
  ...(mod ? { status: r.status, coletado_em: r.coletado_em } : {}),
});

// GET /api/avisos (publico): so os aprovados
export async function listarAvisos(env, url, h) {
  const antes = Number(url.searchParams.get('antes')) || 0;
  const r = await env.DB.prepare(`SELECT * FROM avisos WHERE status = 'aprovado' ${antes ? 'AND id < ?' : ''} ORDER BY id DESC LIMIT 21`).bind(...(antes ? [antes] : [])).all();
  const linhas = r.results.slice(0, 20);
  return h.json({ avisos: linhas.map((x) => saida(x, false)), mais: r.results.length > 20 ? linhas[linhas.length - 1].id : null });
}

// GET /api/admin/avisos (moderador): pendentes (padrao) ou ?status=aprovado|rejeitado
export async function listarAvisosMod(env, url, h) {
  const s = url.searchParams.get('status');
  const status = ['aprovado', 'rejeitado'].includes(s) ? s : 'pendente';
  const r = await env.DB.prepare('SELECT * FROM avisos WHERE status = ? ORDER BY publicado_em DESC LIMIT 100').bind(status).all();
  return h.json({ avisos: r.results.map((x) => saida(x, true)), fontes: Object.entries(FONTES).map(([k, f]) => ({ chave: k, nome: f.nome || 'Google Notícias' })) });
}

// POST /api/admin/avisos/:id { status: 'aprovado'|'rejeitado'|'pendente' } (moderador)
export async function decidirAviso(env, req, user, id, h) {
  const b = await h.body(req);
  if (!b || !['aprovado', 'rejeitado', 'pendente'].includes(b.status)) return h.fail('Escolha aprovar ou rejeitar.');
  const volta = b.status === 'pendente';
  const r = await env.DB.prepare('UPDATE avisos SET status = ?, decidido_por = ?, decidido_em = ? WHERE id = ?')
    .bind(b.status, volta ? null : user.id, volta ? null : h.now(), id).run();
  if (!r.meta || r.meta.changes !== 1) return h.fail('Item não encontrado.', 404);
  return h.json({ ok: true });
}

// POST /api/admin/avisos/coletar (moderador): roda a coleta agora (ao menos 5 min entre duas)
export async function coletarAgora(env, h) {
  const u = await env.DB.prepare('SELECT MAX(coletado_em) AS t FROM avisos').first();
  if (u && u.t && h.now() - u.t < 300) return h.fail('A coleta rodou há poucos minutos. Tente de novo em instantes.', 429);
  return h.json(await coletarAvisos(env, h.now()));
}
