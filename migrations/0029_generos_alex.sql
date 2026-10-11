-- Generos de dois livros do Alex Jr. Kich, definidos por ele em 10/10/2026 (a lista fixa nao reconhecia o texto antigo):
--   "Os Deuses Nao Tem Filhos" -> Ficcao cientifica (a serie "Cronicas Cosmologicas · Livro I" continua no texto de exibicao)
--   "ONZE SEGUNDOS" -> Suspense
-- O tipo de obra (romance, conto...) nao foi informado e fica em branco ate ele escolher. So mexe se o livro existir.

UPDATE profiles SET data = json_set(data,
  '$.obras[' || (SELECT j.key FROM json_each(profiles.data, '$.obras') j WHERE json_extract(j.value, '$.id') = '7b26548055a9') || '].generos', json('["Ficção científica"]'),
  '$.obras[' || (SELECT j.key FROM json_each(profiles.data, '$.obras') j WHERE json_extract(j.value, '$.id') = '7b26548055a9') || '].serie', 'Crônicas Cosmológicas · Livro I',
  '$.obras[' || (SELECT j.key FROM json_each(profiles.data, '$.obras') j WHERE json_extract(j.value, '$.id') = '7b26548055a9') || '].genero', 'Ficção científica · Crônicas Cosmológicas · Livro I')
WHERE slug = 'alex-jr-kich'
  AND EXISTS (SELECT 1 FROM json_each(profiles.data, '$.obras') j WHERE json_extract(j.value, '$.id') = '7b26548055a9');

-- o rascunho (meta) e a copia publicada (pub_meta) ficam iguais
UPDATE studio_works SET
  meta = json_set(COALESCE(meta, '{}'), '$.generos', json('["Suspense"]'), '$.genero', 'Suspense'),
  pub_meta = CASE WHEN pub_meta IS NULL THEN NULL ELSE json_set(pub_meta, '$.generos', json('["Suspense"]'), '$.genero', 'Suspense') END
WHERE id = '98a7c453ee03';
