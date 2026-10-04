// Conteudo editavel da pagina inicial (noticias, projetos, selos, servicos e contato), guardado no D1.
// Antes vinha de public/data.json e so mudava com deploy; agora os moderadores editam pela conta (moderacao.js).
// O esquema abaixo e a UNICA fonte das regras: o servidor valida com ele e o painel monta os formularios a partir dele.

const COR = /^#[0-9a-f]{6}$/i;
const SLUG = /^[a-z0-9-]{1,40}$/;
const DATA = /^\d{2}\/\d{2}\/\d{4}$/;
// link de servico/contato: pagina do proprio site (ajuda.html, autor.html?a=x) ou endereco https / e-mail
const LINK = /^([a-z0-9-]+\.html(\?[a-z0-9=&_-]*)?(#[a-z0-9-]*)?|https:\/\/[^\s"'<>]{3,290}|mailto:[^\s"'<>@]+@[^\s"'<>]+)$/i;

export const SECOES = {
  noticias: {
    rotulo: 'Notícias', item: 'notícia', max: 30,
    campos: [
      { k: 'data', rotulo: 'Data (dd/mm/aaaa)', tipo: 'texto', max: 10, obrig: true, padrao: DATA, erro: 'Data no formato dd/mm/aaaa.' },
      { k: 'titulo', rotulo: 'Título', tipo: 'texto', max: 120, obrig: true },
      { k: 'texto', rotulo: 'Texto', tipo: 'area', max: 1500, obrig: true },
      { k: 'autor', rotulo: 'Assinado por', tipo: 'texto', max: 80 },
      { k: 'autor_slug', rotulo: 'Endereço do perfil de quem assina (opcional)', tipo: 'texto', max: 40, padrao: SLUG, erro: 'Endereço do perfil: só letras minúsculas, números e hífen (ex.: alex-jr-kich).' },
    ],
  },
  projetos: {
    rotulo: 'Projetos em andamento', item: 'projeto', max: 30,
    campos: [
      { k: 'titulo', rotulo: 'Título', tipo: 'texto', max: 120, obrig: true },
      { k: 'autor', rotulo: 'Autor', tipo: 'texto', max: 80 },
      { k: 'autor_slug', rotulo: 'Endereço do perfil do autor (opcional)', tipo: 'texto', max: 40, padrao: SLUG, erro: 'Endereço do perfil: só letras minúsculas, números e hífen.' },
      { k: 'genero', rotulo: 'Gênero', tipo: 'texto', max: 60 },
      { k: 'etapa', rotulo: 'Etapa', tipo: 'escolha', opcoes: ['Planejamento', 'Rascunho', 'Em escrita', 'Revisão', 'Diagramação', 'Quase pronto'] },
      { k: 'pct', rotulo: 'Concluído (%)', tipo: 'numero', min: 0, max: 100 },
      { k: 'previsao', rotulo: 'Previsão (ex.: mar/2027)', tipo: 'texto', max: 30 },
      { k: 'sinopse', rotulo: 'Sinopse curta', tipo: 'area', max: 600 },
      { k: 'trecho', rotulo: 'Trecho (opcional)', tipo: 'area', max: 400 },
      { k: 'c1', rotulo: 'Cor 1', tipo: 'cor' },
      { k: 'c2', rotulo: 'Cor 2', tipo: 'cor' },
    ],
  },
  selos: {
    rotulo: 'Selos da comunidade', item: 'selo', max: 20,
    campos: [
      { k: 'nome', rotulo: 'Nome do selo', tipo: 'texto', max: 60, obrig: true },
      { k: 'texto', rotulo: 'Como se ganha', tipo: 'texto', max: 200 },
    ],
  },
  servicos: {
    rotulo: 'Serviços', item: 'serviço', max: 12,
    campos: [
      { k: 'icone', rotulo: 'Ícone (um símbolo)', tipo: 'texto', max: 4 },
      { k: 'titulo', rotulo: 'Título', tipo: 'texto', max: 80, obrig: true },
      { k: 'status', rotulo: 'Situação', tipo: 'escolha', opcoes: ['Aberto', 'Em breve', 'Pausado'] },
      { k: 'texto', rotulo: 'Descrição', tipo: 'area', max: 400 },
      { k: 'link', rotulo: 'Link do botão (opcional: ajuda.html ou https://...)', tipo: 'texto', max: 300, padrao: LINK, erro: 'Link: uma página do site (ex.: ajuda.html) ou um endereço https://.' },
      { k: 'acao', rotulo: 'Texto do botão', tipo: 'texto', max: 40 },
    ],
  },
  contato: {
    rotulo: 'Contato', unico: true,
    campos: [{ k: 'url', rotulo: 'Canal de contato (https://... ou mailto:...)', tipo: 'texto', max: 300, padrao: LINK, erro: 'Contato: um endereço https:// ou mailto:.' }],
  },
};

const VAZIO = { noticias: [], projetos: [], selos: [], servicos: [], contato: { url: '' } };
const ler = (s) => { try { return JSON.parse(s); } catch { return null; } };

export async function conteudoDoSite(env) {
  const r = await env.DB.prepare('SELECT secao, dados FROM site_conteudo').all();
  const out = structuredClone(VAZIO);
  for (const { secao, dados } of r.results) if (secao in out) { const d = ler(dados); if (d) out[secao] = d; }
  return out;
}

// limpa um item pelo esquema: so campos conhecidos, tamanhos e formatos certos. Devolve [item, erro].
function limparItem(sec, bruto) {
  const item = {};
  if (!bruto || typeof bruto !== 'object') return [null, 'Item inválido.'];
  for (const c of sec.campos) {
    let v = bruto[c.k];
    if (c.tipo === 'numero') {
      v = Math.round(Number(v));
      item[c.k] = Number.isFinite(v) ? Math.min(c.max, Math.max(c.min, v)) : c.min;
      continue;
    }
    v = typeof v === 'string' ? v.replace(/\u0000/g, '').trim().slice(0, c.max || 300) : '';
    if (c.tipo === 'cor' && v && !COR.test(v)) v = '';
    if (c.tipo === 'escolha' && !c.opcoes.includes(v)) v = c.opcoes[0];
    if (c.obrig && !v) return [null, `Preencha "${c.rotulo}" em todos os itens.`];
    if (v && c.padrao && !c.padrao.test(v)) return [null, c.erro];
    item[c.k] = v;
  }
  return [item, null];
}

export async function salvarSecao(env, req, user, secao, h) {
  const sec = SECOES[secao];
  if (!sec) return h.fail('Seção desconhecida.', 404);
  const b = await h.body(req);
  if (!b) return h.fail('Dados inválidos.');
  let dados;
  if (sec.unico) {
    const [item, erro] = limparItem(sec, b.dados);
    if (erro) return h.fail(erro);
    dados = item;
  } else {
    if (!Array.isArray(b.dados)) return h.fail('Dados inválidos.');
    if (b.dados.length > sec.max) return h.fail(`No máximo ${sec.max} itens em ${sec.rotulo}.`);
    dados = [];
    for (const bruto of b.dados) {
      const [item, erro] = limparItem(sec, bruto);
      if (erro) return h.fail(erro);
      dados.push(item);
    }
  }
  await env.DB.prepare(
    'INSERT INTO site_conteudo (secao, dados, atualizado_em, atualizado_por) VALUES (?, ?, ?, ?) ON CONFLICT(secao) DO UPDATE SET dados = excluded.dados, atualizado_em = excluded.atualizado_em, atualizado_por = excluded.atualizado_por'
  ).bind(secao, JSON.stringify(dados), h.now(), user.id).run();
  return h.json({ ok: true, dados });
}

// esquema para o painel (as expressoes regulares viram texto, so para o atributo pattern)
export const esquemaPublico = () => Object.fromEntries(Object.entries(SECOES).map(([k, s]) => [k, {
  ...s, campos: s.campos.map((c) => ({ ...c, padrao: c.padrao ? c.padrao.source : undefined })),
}]));
