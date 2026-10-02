-- Estudio Entrelinhas: nucleo (obras privadas, documentos em arvore, versoes).
-- Tudo aqui e PRIVADO do dono (users.id). Nada entra em perfil/biblioteca publica sem a acao PUBLICAR.

CREATE TABLE studio_works (
  id TEXT PRIMARY KEY,                       -- 12 hex aleatorios
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'texto' CHECK (kind IN ('texto', 'hq', 'hibrida')),
  status TEXT NOT NULL DEFAULT 'rascunho'
    CHECK (status IN ('rascunho', 'em_revisao', 'agendado', 'publicado', 'atualizado', 'arquivado')),
  meta TEXT NOT NULL DEFAULT '{}',           -- JSON: sinopse, genero, capa, creditos...
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER                         -- soft delete
);
CREATE INDEX idx_studio_works_user ON studio_works(user_id, deleted_at, updated_at);

-- Arvore de pastas e documentos da obra. O corpo (Markdown) so e lido sob demanda.
CREATE TABLE studio_docs (
  id TEXT PRIMARY KEY,
  work_id TEXT NOT NULL REFERENCES studio_works(id) ON DELETE CASCADE,
  parent_id TEXT,                            -- pasta pai (NULL = raiz da obra)
  kind TEXT NOT NULL CHECK (kind IN ('pasta', 'doc')),
  doc_type TEXT NOT NULL DEFAULT 'nota',     -- capitulo, cena, personagem, lugar, objeto, evento, pesquisa, nota | pasta e pastas especiais
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',             -- Markdown
  position REAL NOT NULL DEFAULT 0,          -- ordem entre irmaos (fracionaria)
  version INTEGER NOT NULL DEFAULT 1,        -- controle otimista de edicao
  words INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER                         -- lixeira (soft delete)
);
CREATE INDEX idx_studio_docs_work ON studio_docs(work_id, deleted_at, parent_id, position);

-- Snapshots do corpo: periodicos, antes de operacoes destrutivas e sob pedido.
CREATE TABLE studio_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_id TEXT NOT NULL REFERENCES studio_docs(id) ON DELETE CASCADE,
  work_id TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT 'auto',       -- auto | manual | restauracao | publicacao | exclusao
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_studio_versions_doc ON studio_versions(doc_id, created_at);
