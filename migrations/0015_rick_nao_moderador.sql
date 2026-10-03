-- Rick (perfil "rick") nao e moderador nem idealizador: tira a marca de moderador da conta.
-- Some o selo "Moderador e Idealizador" do perfil e da lista de autores, e o acesso ao painel e ao chat da moderacao.
-- A etiqueta "Fundador" (profiles.badges) nao muda.
UPDATE users SET is_admin = 0 WHERE slug = 'rick';
