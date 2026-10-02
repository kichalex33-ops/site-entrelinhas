-- Estudio Entrelinhas: arquivo original de um manuscrito importado, guardado PRIVADO junto da obra.
-- O D1 limita cada linha a 2 MB, entao o arquivo guardado tem no maximo 1,5 MB (a importacao em si nao tem esse limite).
CREATE TABLE studio_files (
  id TEXT PRIMARY KEY,
  work_id TEXT NOT NULL REFERENCES studio_works(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  data BLOB NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_studio_files_work ON studio_files(work_id);
