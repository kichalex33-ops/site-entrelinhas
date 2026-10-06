-- Caixa de mensagens do contato@entrelinhasbr.com.br: o Cloudflare Email Routing entrega cada e-mail ao handler
-- email() do Worker (src/contato.js), que guarda aqui e encaminha uma copia para a caixa do Proton.
-- Os moderadores leem no painel, cada um com a propria conta (sem senha compartilhada).
-- Anexos nao sao guardados: so os nomes (a copia no Proton tem o e-mail completo). Mensagens somem depois de 1 ano.
CREATE TABLE contato_mensagens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  remetente TEXT NOT NULL,              -- endereco do envelope (SMTP), o confiavel
  nome TEXT NOT NULL DEFAULT '',        -- nome no cabecalho From, se houver
  responder_para TEXT NOT NULL DEFAULT '',
  assunto TEXT NOT NULL DEFAULT '',
  texto TEXT NOT NULL DEFAULT '',
  anexos TEXT NOT NULL DEFAULT '[]',    -- nomes dos anexos (JSON)
  message_id TEXT NOT NULL DEFAULT '',
  tamanho INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'nova',  -- nova | lida | arquivada
  lida_por INTEGER REFERENCES users(id) ON DELETE SET NULL,
  lida_em INTEGER,
  recebida_em INTEGER NOT NULL
);
CREATE INDEX idx_contato_mensagens_status ON contato_mensagens(status, recebida_em);
