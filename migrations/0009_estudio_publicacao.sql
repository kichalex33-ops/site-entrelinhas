-- Estudio Entrelinhas: publicacao. SALVAR nao e PUBLICAR: o que o publico le vem SO desta copia (snapshot) feita
-- no momento de publicar/agendar/atualizar; editar o rascunho nao muda o que esta publicado.

ALTER TABLE studio_works ADD COLUMN pub_slug TEXT;                           -- endereco estavel da obra (por autor)
ALTER TABLE studio_works ADD COLUMN pub_version INTEGER NOT NULL DEFAULT 0;  -- sobe a cada publicacao/atualizacao
ALTER TABLE studio_works ADD COLUMN pub_meta TEXT;                           -- JSON: titulo, genero, sinopse, creditos, capa (copia publica)
ALTER TABLE studio_works ADD COLUMN published_at INTEGER;                    -- 1a publicacao (ou data do agendamento)
ALTER TABLE studio_works ADD COLUMN scheduled_at INTEGER;                    -- quando o status e 'agendado'
CREATE UNIQUE INDEX idx_studio_works_slug ON studio_works(user_id, pub_slug) WHERE pub_slug IS NOT NULL;

-- copia publica dos capitulos, na ordem de leitura (o corpo fica como no rascunho; o que e privado sai na hora de ler)
CREATE TABLE studio_pub_docs (
  work_id TEXT NOT NULL REFERENCES studio_works(id) ON DELETE CASCADE,
  ordem INTEGER NOT NULL,
  doc_id TEXT NOT NULL,
  titulo TEXT NOT NULL DEFAULT '',
  corpo TEXT NOT NULL DEFAULT '',
  palavras INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (work_id, ordem)
);

-- declaracao de autoria/originalidade/responsabilidade, versionada. provisorio = 1 enquanto o texto nao foi aprovado.
CREATE TABLE studio_declarations (
  versao INTEGER PRIMARY KEY,
  texto TEXT NOT NULL,
  provisorio INTEGER NOT NULL DEFAULT 0,
  criado_em INTEGER NOT NULL
);
INSERT INTO studio_declarations (versao, texto, provisorio, criado_em) VALUES (
  1,
  'Declaro que sou o autor ou a autora desta obra, ou que tenho autorizacao de quem e para publica-la no Entrelinhas. Declaro que ela e original, ou que os trechos de terceiros estao indicados e autorizados, e que a publicacao nao viola direitos de ninguem. Sou responsavel pelo conteudo que publico e entendo que posso tirar a obra do ar quando quiser.',
  1,
  strftime('%s', 'now')
);

-- registro de cada aceite: quem, qual obra, qual versao da declaracao, qual publicacao e quando
CREATE TABLE studio_acceptances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_id TEXT NOT NULL REFERENCES studio_works(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  declaration_version INTEGER NOT NULL REFERENCES studio_declarations(versao),
  acao TEXT NOT NULL,              -- publicar | agendar | atualizar
  pub_version INTEGER NOT NULL,
  accepted_at INTEGER NOT NULL
);
CREATE INDEX idx_studio_acceptances_work ON studio_acceptances(work_id, accepted_at);
