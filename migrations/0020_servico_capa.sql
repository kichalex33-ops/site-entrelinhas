-- Card "Capa e diagramacao" passa a abrir o editor de capa (com visualizacao 3D).
-- Reescreve so esse item da secao 'servicos'; os demais ficam como os moderadores deixaram.
UPDATE site_conteudo
SET dados = (
  SELECT json_group_array(json(
    CASE WHEN json_extract(value, '$.titulo') = 'Capa e diagramação'
      THEN json_set(value, '$.status', 'Aberto', '$.link', 'editor-capa.html', '$.acao', 'Abrir editor',
                    '$.texto', 'Crie a capa aberta em 300 DPI, veja em 3D e exporte em JPG ou PDF.')
      ELSE value END))
  FROM json_each(site_conteudo.dados)
)
WHERE secao = 'servicos';
