-- Declaracao de autoria definitiva (versao 2), substituindo a provisoria (versao 1, migracao 0009).
-- A versao 1 e os aceites ja registrados com ela ficam como estao (historico). A partir desta migracao,
-- publicar, agendar ou atualizar exige o aceite da versao 2 (src/studio.js usa sempre a versao mais alta).
-- Formato: a primeira linha e a introducao; as linhas que comecam com "- " viram itens na tela de publicacao.
INSERT INTO studio_declarations (versao, texto, provisorio, criado_em) VALUES (
  2,
  'Ao publicar esta obra no Entrelinhas, declaro que:
- sou o autor ou a autora da obra, ou tenho autorização suficiente de quem detém os direitos para publicá-la;
- tenho o direito de usar os textos, as imagens e os demais materiais que estou enviando;
- o conteúdo de terceiros incluído na obra tem autorização ou base legal adequada (como citação com crédito);
- não estou publicando, de forma deliberada, obra plagiada ou pirateada;
- sou responsável pelo conteúdo que publico;
- concedo ao Entrelinhas apenas a licença necessária para armazenar, processar e exibir a obra dentro da plataforma, enquanto ela estiver publicada;
- os direitos autorais continuam sendo meus ou de quem os detém: o Entrelinhas não se torna dono da obra;
- posso tirar a obra do ar quando quiser;
- li e aceito os Termos de Uso, a Política de Privacidade e as Diretrizes da Comunidade.',
  0,
  strftime('%s', 'now')
);
