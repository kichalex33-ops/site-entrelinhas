-- Denuncias de livros (plagio, pirataria, IA sem aviso, classificacao errada...). Uma por pessoa por livro.
CREATE TABLE book_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  autor_slug TEXT NOT NULL,
  obra_id TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  motivo TEXT NOT NULL,
  detalhe TEXT NOT NULL DEFAULT '',
  link TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'aberta', -- aberta | resolvida | arquivada
  nota TEXT NOT NULL DEFAULT '',
  resolved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  resolved_at INTEGER,
  created_at INTEGER NOT NULL,
  UNIQUE (obra_id, user_id)
);
CREATE INDEX idx_book_reports_status ON book_reports(status, created_at);
CREATE INDEX idx_book_reports_obra ON book_reports(obra_id, status);
