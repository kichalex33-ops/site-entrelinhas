-- Lixeira de livros do perfil: o livro removido fica guardado (com o mesmo id), so o autor ve.
-- Avaliacoes, favoritos, pagina do livro e extras continuam ligados ao id e voltam ao restaurar.
-- Obras do Estudio ja usam studio_works.deleted_at e aparecem na mesma lixeira.
CREATE TABLE book_trash (
  obra_id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  data TEXT NOT NULL,          -- o livro como estava no perfil
  removed_at INTEGER NOT NULL
);
CREATE INDEX idx_book_trash_user ON book_trash(user_id, removed_at);
