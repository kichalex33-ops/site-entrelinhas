-- Estudio Entrelinhas: busca, tags e links internos. Tudo derivado do texto/dono do documento e PRIVADO.

-- Indice de busca sem acento e sem diferenca de caixa (a coluna original continua intacta).
-- Tabela propria para nao somar ao limite de linha do D1 (2 MB) junto com o corpo.
CREATE TABLE studio_search (
  doc_id TEXT PRIMARY KEY REFERENCES studio_docs(id) ON DELETE CASCADE,
  work_id TEXT NOT NULL,
  norm_title TEXT NOT NULL,
  norm_body TEXT NOT NULL
);
CREATE INDEX idx_studio_search_work ON studio_search(work_id);

-- Tags privadas. origem: 'manual' (digitada no painel) ou 'texto' (#hashtag escrita no corpo).
CREATE TABLE studio_doc_tags (
  doc_id TEXT NOT NULL REFERENCES studio_docs(id) ON DELETE CASCADE,
  work_id TEXT NOT NULL,
  tag TEXT NOT NULL,
  origem TEXT NOT NULL DEFAULT 'manual',
  PRIMARY KEY (doc_id, tag)
);
CREATE INDEX idx_studio_tags_work ON studio_doc_tags(work_id, tag);

-- Links internos [[Titulo]] entre documentos da mesma obra. A resolucao e feita pelo titulo normalizado
-- no momento da leitura, entao renomear ou criar o documento de destino "conserta" o link sozinho.
CREATE TABLE studio_links (
  work_id TEXT NOT NULL,
  from_doc TEXT NOT NULL REFERENCES studio_docs(id) ON DELETE CASCADE,
  to_norm TEXT NOT NULL,        -- titulo citado, normalizado
  to_title TEXT NOT NULL,       -- como foi escrito
  PRIMARY KEY (from_doc, to_norm)
);
CREATE INDEX idx_studio_links_to ON studio_links(work_id, to_norm);
