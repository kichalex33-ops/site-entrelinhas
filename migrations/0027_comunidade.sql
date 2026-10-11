-- Comunidade (aba nova): noticias, resenhas, recomendacoes de leitura e dicas de escrita.
-- Postam autores e moderadores; o autor edita e apaga os proprios posts; o moderador oculta (hidden = 1) qualquer um.
CREATE TABLE community_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK (tipo IN ('noticia', 'resenha', 'recomendacao', 'dica')),
  titulo TEXT NOT NULL,
  texto TEXT NOT NULL,
  livro TEXT NOT NULL DEFAULT '',   -- resenha/recomendacao: "Titulo, de Autor" (texto livre)
  link TEXT NOT NULL DEFAULT '',    -- opcional, so http(s)
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0,
  hidden_by INTEGER,
  hidden_at INTEGER
);
CREATE INDEX idx_community_posts_lista ON community_posts(hidden, created_at);
CREATE INDEX idx_community_posts_user ON community_posts(user_id, created_at);

-- as noticias da pagina inicial que tem autor com conta viram posts da Comunidade (data dd/mm/aaaa -> meio-dia UTC)
INSERT INTO community_posts (user_id, tipo, titulo, texto, created_at, updated_at)
SELECT u.id, 'noticia', json_extract(n.value, '$.titulo'), json_extract(n.value, '$.texto'),
       COALESCE(CAST(strftime('%s', substr(json_extract(n.value, '$.data'), 7, 4) || '-' || substr(json_extract(n.value, '$.data'), 4, 2) || '-' || substr(json_extract(n.value, '$.data'), 1, 2) || ' 12:00:00') AS INTEGER), strftime('%s', 'now')),
       COALESCE(CAST(strftime('%s', substr(json_extract(n.value, '$.data'), 7, 4) || '-' || substr(json_extract(n.value, '$.data'), 4, 2) || '-' || substr(json_extract(n.value, '$.data'), 1, 2) || ' 12:00:00') AS INTEGER), strftime('%s', 'now'))
FROM site_conteudo s, json_each(s.dados) n JOIN users u ON u.slug = json_extract(n.value, '$.autor_slug')
WHERE s.secao = 'noticias' AND COALESCE(json_extract(n.value, '$.titulo'), '') != '' AND COALESCE(json_extract(n.value, '$.texto'), '') != '';

-- a secao antiga de noticias sai do painel (agora e a Comunidade); fica vazia, nao apagada
UPDATE site_conteudo SET dados = '[]', atualizado_em = strftime('%s', 'now') WHERE secao = 'noticias';
