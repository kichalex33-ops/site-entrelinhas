-- Pagina do livro: contexto, estilo, personagens, galeria e materiais complementares, preenchidos pelo autor.
-- Vale para livros divulgados no perfil e para obras do Estudio (os dois usam id de 12 hex).
CREATE TABLE book_pages (
  obra_id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_book_pages_user ON book_pages(user_id);
