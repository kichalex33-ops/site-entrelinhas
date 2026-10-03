-- Perfil de leitor (leitor.html): foto, bio, local, privacidade, quem segue quem e estantes.
ALTER TABLE users ADD COLUMN bio TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN foto TEXT NOT NULL DEFAULT ''; -- id em images
ALTER TABLE users ADD COLUMN local TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN privado INTEGER NOT NULL DEFAULT 0; -- 1: visitantes so veem nome e foto

-- seguir: qualquer conta segue autores e leitores (seguido_slug = users.slug)
CREATE TABLE follows (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  seguido_slug TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, seguido_slug)
);
CREATE INDEX idx_follows_seguido ON follows(seguido_slug);

-- estantes: cinco fixas (um livro fica em so uma delas) + listas proprias com titulo.
-- publica = 0 esconde a lista no perfil publico.
CREATE TABLE reader_lists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chave TEXT NOT NULL DEFAULT '', -- lendo | quero | lidos | pausado | abandonado | '' (lista propria)
  nome TEXT NOT NULL,
  publica INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_reader_lists_chave ON reader_lists(user_id, chave) WHERE chave != '';

CREATE TABLE reader_list_items (
  list_id INTEGER NOT NULL REFERENCES reader_lists(id) ON DELETE CASCADE,
  obra_id TEXT NOT NULL,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (list_id, obra_id)
);
CREATE INDEX idx_reader_list_items_obra ON reader_list_items(obra_id);
