-- Tokens de redefinicao de senha: so o HASH do token vai pro banco (igual sessions/invites).
CREATE TABLE password_resets (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  used       INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_resets_user ON password_resets(user_id);
