-- Feedback do beta (feedback.html): bug, confusao, sugestao ou visual, com a area e a pagina de onde veio.
-- user_id e opcional (quem nao entrou tambem pode mandar). Os moderadores leem no painel e marcam como visto.
CREATE TABLE feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  area TEXT NOT NULL,
  categoria TEXT NOT NULL,              -- bug | confusao | sugestao | visual
  descricao TEXT NOT NULL,
  pagina TEXT NOT NULL DEFAULT '',      -- caminho de origem, sem parametros (nunca leva token de link)
  status TEXT NOT NULL DEFAULT 'novo',  -- novo | visto
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_feedback_status ON feedback(status, created_at);
