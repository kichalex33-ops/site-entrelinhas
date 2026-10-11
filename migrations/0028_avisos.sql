-- Editais e eventos para autores (Comunidade > "Editais e eventos"): itens coletados todo dia de feeds publicos.
-- Guarda so titulo, fonte, link e data: o texto das materias nao e copiado. Nada aparece antes de um moderador aprovar.
CREATE TABLE avisos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fonte TEXT NOT NULL,              -- nome mostrado (ex.: "Jornal RelevO" ou o veiculo que o Google Noticias informa)
  feed TEXT NOT NULL,               -- chave da fonte em src/avisos.js
  titulo TEXT NOT NULL,
  link TEXT NOT NULL UNIQUE,        -- so http(s); a repeticao e descartada
  publicado_em INTEGER NOT NULL,    -- data do item no feed (ou a da coleta, se vier invalida)
  coletado_em INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'aprovado', 'rejeitado')),
  decidido_por INTEGER REFERENCES users(id) ON DELETE SET NULL,
  decidido_em INTEGER
);
CREATE INDEX idx_avisos_status ON avisos(status, publicado_em);
