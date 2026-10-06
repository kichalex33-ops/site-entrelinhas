-- Confirmacao de e-mail das contas novas.
-- email_status: 'pendente' (conta nova, ainda nao confirmou) | 'confirmado' | 'legado' (conta criada antes desta
-- migracao: segue funcionando como sempre, sem bloqueio; autores entraram por convite e leitores pelo Turnstile).
-- O bloqueio de acoes publicas para 'pendente' so vale quando o envio de e-mail esta configurado (RESEND_API_KEY).
ALTER TABLE users ADD COLUMN email_status TEXT NOT NULL DEFAULT 'pendente';
UPDATE users SET email_status = 'legado';
ALTER TABLE users ADD COLUMN email_confirmado_em INTEGER;

-- links de confirmacao: so o hash do token; uso unico; 48 h. As linhas ficam ate vencer (servem para o limite de reenvio).
CREATE TABLE email_confirmations (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_email_confirmations_user ON email_confirmations(user_id, created_at);
