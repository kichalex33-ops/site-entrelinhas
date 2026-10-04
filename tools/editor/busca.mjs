// Busca da Biblioteca (index.html), com MiniSearch: titulo, autor e genero, enquanto a pessoa digita.
// Roda so no navegador, sobre os livros que a vitrine ja carregou; nao chama o servidor.
// Ignora acentos e maiusculas ("ficcao cientifica" acha "Ficção Científica") e tolera erros de digitacao.
import MiniSearch from 'minisearch';

const normalizar = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// livros: [{ id, titulo, autorNome, genero }]. Devolve buscar(texto) -> Set de ids (null = texto vazio, mostra tudo).
export function criarBusca(livros) {
  const ms = new MiniSearch({
    fields: ['titulo', 'autorNome', 'genero'],
    processTerm: (t) => normalizar(t) || null,
    searchOptions: {
      boost: { titulo: 3, autorNome: 2 }, prefix: true, combineWith: 'AND',
      fuzzy: (termo) => (termo.length > 3 ? 0.2 : false),
    },
  });
  ms.addAll(livros);
  return (texto) => {
    const q = String(texto || '').trim();
    return q ? new Set(ms.search(q).map((r) => r.id)) : null;
  };
}
