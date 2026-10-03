-- Ajuda entre autores (aba Servicos): um autor pede ajuda (leitura beta primeiro), outros se oferecem,
-- o dono aceita e, ao concluir, quem ajudou ganha o selo do servico no perfil.
CREATE TABLE help_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL,                 -- beta | critica | divulgacao | capa
  titulo TEXT NOT NULL,
  genero TEXT NOT NULL DEFAULT '',
  descricao TEXT NOT NULL DEFAULT '', -- sinopse / o que e o texto
  tamanho TEXT NOT NULL DEFAULT '',   -- ex.: "12 capitulos, 40 mil palavras"
  retorno TEXT NOT NULL DEFAULT '',   -- o que o autor quer saber
  prazo TEXT NOT NULL DEFAULT '',
  acesso TEXT NOT NULL DEFAULT '',    -- como chegar ao original: so quem foi aceito ve
  vagas INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'aberto', -- aberto | fechado
  created_at INTEGER NOT NULL,
  closed_at INTEGER
);
CREATE INDEX idx_help_requests_status ON help_requests(status, tipo, created_at);
CREATE INDEX idx_help_requests_user ON help_requests(user_id);

CREATE TABLE help_offers (
  request_id INTEGER NOT NULL REFERENCES help_requests(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  msg TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'oferta', -- oferta | aceito | concluido | recusado
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (request_id, user_id)
);
CREATE INDEX idx_help_offers_user ON help_offers(user_id, status);
