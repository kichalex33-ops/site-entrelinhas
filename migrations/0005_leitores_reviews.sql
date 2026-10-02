-- Fase 1: contas de leitor e reviews.
-- role: 'autor' (cadastro por convite, tem perfil) ou 'leitor' (cadastro aberto, sem perfil).
ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'autor';
-- nome de exibicao dos leitores (autores usam o nome do perfil).
ALTER TABLE users ADD COLUMN nome TEXT NOT NULL DEFAULT '';

-- review de uma obra (obra identificada por perfil + id estavel dentro do perfil).
CREATE TABLE reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  author_slug TEXT NOT NULL,
  obra_id TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nota INTEGER NOT NULL CHECK (nota BETWEEN 1 AND 5),
  texto TEXT NOT NULL,
  spoiler INTEGER NOT NULL DEFAULT 0,
  hidden INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (author_slug, obra_id, user_id)
);
CREATE INDEX idx_reviews_obra ON reviews(author_slug, obra_id);
CREATE INDEX idx_reviews_user ON reviews(user_id);

-- "util" (upvote): uma por pessoa por review.
CREATE TABLE review_votes (
  review_id INTEGER NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (review_id, user_id)
);

-- denuncias: motivo = spoiler | ofensivo | spam.
CREATE TABLE review_reports (
  review_id INTEGER NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  motivo TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (review_id, user_id)
);
