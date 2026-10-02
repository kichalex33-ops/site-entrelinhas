-- Marca os fundadores com a etiqueta "Fundador" (campo badges do perfil).
-- Seguro para rodar mais de uma vez: nao duplica a etiqueta.
-- Aplicar: wrangler d1 execute entrelinhas-db --remote --file scripts/fundadores.sql
UPDATE profiles
SET badges = json_insert(badges, '$[#]', 'Fundador')
WHERE slug IN ('alex-jr-kich', 'lucas-a-silva', 'mario-junio-maduro-da-silva', 'ricardo-f-c', 'rick', 'yuri-silva')
  AND NOT EXISTS (SELECT 1 FROM json_each(profiles.badges) WHERE value = 'Fundador');
