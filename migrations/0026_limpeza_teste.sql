-- Limpeza antes do beta (10/10/2026): sai do site o que era teste ou exemplo ficticio.
--   - noticias assinadas por autores ficticios do antigo data.json (Helena Prado, R. Tavares)
--   - os tres projetos ficticios (Helena Prado, M. Sato, J. Ferreira), todos sem perfil no site
--   - os dois livros de teste do Yuri publicados pelo Estudio: vao para a lixeira dele (deleted_at), nao somem de vez
-- So apaga itens sem perfil ligado (autor_slug vazio), para nunca levar junto um texto real com o mesmo nome.
UPDATE site_conteudo SET
  dados = (SELECT json_group_array(json(value)) FROM json_each(site_conteudo.dados)
           WHERE NOT (COALESCE(json_extract(value, '$.autor_slug'), '') = '' AND json_extract(value, '$.autor') IN ('Helena Prado', 'R. Tavares'))),
  atualizado_em = strftime('%s', 'now')
WHERE secao = 'noticias';

UPDATE site_conteudo SET
  dados = (SELECT json_group_array(json(value)) FROM json_each(site_conteudo.dados)
           WHERE NOT (COALESCE(json_extract(value, '$.autor_slug'), '') = '' AND json_extract(value, '$.autor') IN ('Helena Prado', 'M. Sato', 'J. Ferreira'))),
  atualizado_em = strftime('%s', 'now')
WHERE secao = 'projetos';

UPDATE studio_works SET deleted_at = strftime('%s', 'now')
WHERE id IN ('ac5b66dbdc4d', 'a6de8da2d3cc') AND deleted_at IS NULL
  AND user_id = (SELECT id FROM users WHERE slug = 'yuri-silva');
