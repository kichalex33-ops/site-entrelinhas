-- Pagina do livro: favoritos, visualizacoes e "Extras e Notas" (posts do autor com curtidas).
-- Os comentarios dos posts ficam no Disqus (identificador livro-post-<id>), nao aqui.
CREATE TABLE book_favorites (
  obra_id TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (obra_id, user_id)
);
CREATE INDEX idx_book_favorites_user ON book_favorites(user_id);

-- uma visita por visitante por dia; visitante = hash de IP + navegador + dia (o IP nao fica gravado)
CREATE TABLE book_views (
  obra_id TEXT NOT NULL,
  visitante TEXT NOT NULL,
  dia INTEGER NOT NULL,
  PRIMARY KEY (obra_id, dia, visitante)
);

CREATE TABLE book_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  obra_id TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  texto TEXT NOT NULL DEFAULT '',
  imagem TEXT NOT NULL DEFAULT '',
  spoiler INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_book_posts_obra ON book_posts(obra_id, created_at);
CREATE INDEX idx_book_posts_user ON book_posts(user_id);

CREATE TABLE book_post_likes (
  post_id INTEGER NOT NULL REFERENCES book_posts(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, user_id)
);
