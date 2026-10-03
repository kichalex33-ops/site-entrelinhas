-- Convites gerados pelo painel de moderacao: quem gerou, para quem (anotacao) e validade.
-- Convites antigos (gerados por script) ficam sem validade, como antes.
ALTER TABLE invites ADD COLUMN created_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE invites ADD COLUMN para TEXT NOT NULL DEFAULT '';
ALTER TABLE invites ADD COLUMN expires_at INTEGER;
