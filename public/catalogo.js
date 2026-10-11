// Generos e tipos de obra do site: lista fixa, a mesma nos filtros da Biblioteca, em Minha conta e no Estudio.
// Arquivo unico para o Worker (importado por src/) e para o navegador (import('/catalogo.js')).
// O autor escolhe ate 2 generos e 1 tipo; serie/volume ("Cronicas Cosmologicas · Livro I") e um campo a parte.
// Livros antigos guardam so o texto livre `genero`: classificar() reconhece nele os generos da lista (por apelido).

export const GENEROS = [
  'Fantasia', 'Ficção científica', 'Terror', 'Suspense', 'Policial', 'Romântico', 'Drama', 'Aventura',
  'Distopia', 'Histórico', 'Infantil', 'Juvenil', 'Humor', 'Poesia', 'Não-ficção', 'Biografia e memórias',
];
export const TIPOS = ['Romance', 'Novela', 'Conto', 'Antologia', 'Crônica', 'Poesia', 'HQ', 'Roteiro', 'Não-ficção'];
export const MAX_GENEROS = 2;
// etapas de um projeto em andamento (aba Projetos): as mesmas no painel da moderacao e no Estudio
export const ETAPAS = ['Planejamento', 'Rascunho', 'Em escrita', 'Revisão', 'Diagramação', 'Quase pronto'];

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// apelidos do texto livre antigo -> genero da lista
const APELIDOS = new Map([
  ...GENEROS.map((g) => [norm(g), g]),
  ['science fiction', 'Ficção científica'], ['sci-fi', 'Ficção científica'], ['scifi', 'Ficção científica'], ['ficcao cientifica', 'Ficção científica'],
  ['fantasy', 'Fantasia'], ['horror', 'Terror'], ['thriller', 'Suspense'], ['misterio', 'Suspense'], ['romance policial', 'Policial'],
  ['literatura infantil', 'Infantil'], ['infantojuvenil', 'Juvenil'], ['infanto-juvenil', 'Juvenil'], ['young adult', 'Juvenil'], ['ya', 'Juvenil'],
  ['romantico', 'Romântico'], ['comedia', 'Humor'], ['acao', 'Aventura'], ['nao ficcao', 'Não-ficção'], ['biografia', 'Biografia e memórias'],
  ['memorias', 'Biografia e memórias'], ['historico', 'Histórico'], ['ficcao historica', 'Histórico'], ['distopico', 'Distopia'],
]);
const TIPO_DE = new Map(TIPOS.map((t) => [norm(t), t]));

const str = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n);

// valida o que veio do formulario: so itens da lista, sem repeticao
export function lerClassificacao(o) {
  const generos = [];
  for (const g of Array.isArray(o && o.generos) ? o.generos : []) {
    const ok = APELIDOS.get(norm(g));
    if (ok && GENEROS.includes(ok) && !generos.includes(ok) && generos.length < MAX_GENEROS) generos.push(ok);
  }
  const tipo = TIPO_DE.get(norm(o && o.tipo)) || '';
  const serie = str(o && o.serie, 80);
  // `genero` continua existindo como texto de exibicao (paginas do livro, cartoes, SEO)
  return { generos, tipo, serie, genero: [...generos, serie].filter(Boolean).join(' · ') };
}

// classificacao de um livro qualquer: campos novos, ou o reconhecido no texto livre antigo
export function classificar(o) {
  if (o && Array.isArray(o.generos)) return { generos: lerClassificacao(o).generos, tipo: TIPO_DE.get(norm(o.tipo)) || '' };
  const generos = [];
  for (const parte of String((o && o.genero) || '').split(/\s*[·,/;|]\s*/)) {
    const g = APELIDOS.get(norm(parte));
    if (g && !generos.includes(g)) generos.push(g);
  }
  return { generos: generos.slice(0, MAX_GENEROS), tipo: TIPO_DE.get(norm(o && o.tipo)) || '' };
}


// ---- formulario (Minha conta e Estudio): os mesmos campos nos dois lugares ----
// `o` pode ser livro antigo (so `genero` em texto livre): os generos reconhecidos vem marcados e o resto vira serie.
export function camposHtml(o, esc, cls = '') {
  const c = Array.isArray(o.generos) ? { generos: o.generos, serie: o.serie || '' } : (() => {
    const { generos } = classificar(o);
    const resto = String(o.genero || '').split(/\s*[·,/;|]\s*/).filter((p) => p && !APELIDOS.has(norm(p))).join(' · ');
    return { generos, serie: resto };
  })();
  const tipo = TIPO_DE.get(norm(o.tipo)) || '';
  const opcoes = (lista, atual, vazio) => `<option value="">${vazio}</option>` + lista.map((v) => `<option${v === atual ? ' selected' : ''}>${esc(v)}</option>`).join('');
  return `<div class="fld-classif ${cls}">
      <label class="fld"><span>Gênero</span><select name="genero1">${opcoes(GENEROS, c.generos[0] || '', 'Escolha o gênero')}</select></label>
      <label class="fld"><span>Segundo gênero (opcional)</span><select name="genero2">${opcoes(GENEROS, c.generos[1] || '', 'Nenhum')}</select></label>
      <label class="fld"><span>Tipo de obra</span><select name="tipo">${opcoes(TIPOS, tipo, 'Escolha o tipo')}</select></label>
      <label class="fld"><span>Série e volume (opcional)</span><input name="serie" maxlength="80" value="${esc(c.serie)}" placeholder="ex.: Crônicas Cosmológicas · Livro I"></label>
    </div>`;
}
// le os campos acima de dentro de um elemento (form ou div)
export function lerCampos(raiz) {
  const v = (n) => { const e = raiz.querySelector(`[name="${n}"]`); return e ? e.value : ''; };
  return lerClassificacao({ generos: [v('genero1'), v('genero2')].filter(Boolean), tipo: v('tipo'), serie: v('serie') });
}
