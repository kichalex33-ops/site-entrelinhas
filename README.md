# site-entrelinhas

Site do **Entrelinhas**, coletivo de escritores independentes: [entrelinhasbr.com.br](https://entrelinhasbr.com.br).

Um Cloudflare Worker (`src/`) com banco D1 serve a API, e os arquivos de `public/` saem como estáticos. Não há etapa de build no deploy: o JavaScript do navegador é escrito à mão, e as bibliotecas de terceiros (ProseMirror, Mammoth, markdown-it, docx, Cropper.js, MiniSearch) são empacotadas uma vez em `public/vendor/` e versionadas.

## O que o site faz hoje

| Área | Páginas | Servidor |
|---|---|---|
| Vitrine: página inicial, Biblioteca (com busca), Lançamentos, Projetos, Serviços | `index.html`, `app.js` | `src/vitrine.js` (livros), `src/site.js` (notícias, projetos, selos, serviços e contato, editáveis pelos moderadores) |
| Contas: login, cadastro de leitor (Turnstile) e de autor (por convite), recuperar senha, apagar conta | `conta.html`, `conta.js`, `recuperar.html`, `redefinir.html` | `src/index.js` |
| Perfil público do autor e lista de autores | `autor.html`, `autores.html` | `src/index.js` (`profiles`) |
| Estúdio: editor de manuscrito com autosave, notas, fichas, links `[[...]]`, tags, busca, importar/exportar DOCX/TXT/Markdown, publicar e agendar | `estudio.html`, `estudio/*.js` | `src/studio.js` |
| Leitura pública das obras publicadas (cópia feita ao publicar, não o rascunho) | `ler.html` | `src/leitura.js` |
| Página do livro: personagens, galeria, materiais, extras, avaliações, favoritos | `obra.html`, `reviews.js` | `src/livro.js` |
| Perfil de leitor: estantes, seguir, atividade, perfil privado | `leitor.html` | `src/leitor.js` |
| Comunidade: ajuda entre autores (leitura beta), denúncias, lixeira de livros, chat da moderação | `ajuda.html`, `lixeira.html`, `chat.html`, `moderacao.js` | `src/ajuda.js`, `src/denuncias.js`, `src/lixeira.js` |

O banco é definido só pelas migrações em `migrations/` (aplicadas em ordem).

## Segurança, em resumo

- Sessão por cookie `HttpOnly; Secure; SameSite=Strict`; o banco guarda só o hash do token. Senhas com PBKDF2.
- Toda escrita exige o cabeçalho `X-Requested-With: fetch` (CSRF), e o cadastro de leitor passa pelo Turnstile.
- Limites: tentativas de login/cadastro/recuperação (`login_fails`), limites diários por função e um **limite geral de escritas** por sessão/IP (Rate Limiting do Cloudflare, `ESCRITAS` em `wrangler.jsonc`).
- Tudo no Estúdio é filtrado pelo dono da obra; os testes cobrem acesso cruzado (IDOR).
- O HTML montado no navegador passa por `esc()`, e os links só aceitam `http(s)`. Uploads conferem o tamanho real e o tipo.

## Rodar e testar

```sh
npm ci
npm test            # testes de unidade e da API (Worker real + SQLite em memória)
npm run e2e         # testes no navegador (usa o Chrome instalado; CHROME_PATH se estiver em outro lugar)
npm run build:editor  # só depois de mexer em tools/editor/ ou atualizar bibliotecas: regenera public/vendor/
```

## Deploy

Push na `main` → GitHub Actions (`.github/workflows/deploy.yml`):
**testes de unidade + navegador → migrações do D1 → `wrangler deploy` → conferência do site no ar** (`tools/smoke.mjs`).
Se um teste falha, nada vai para produção. Pull requests rodam só os testes.

O site fica na conta Cloudflare do Entrelinhas, não na do Sinal/Ruído. Não rode `wrangler deploy` local sem conferir `wrangler whoami`. Mudanças em dados de produção também vão por migração.

## Pendências conhecidas

- A declaração de autoria da publicação ainda é **provisória** (`studio_declarations.provisorio = 1`), à espera do texto revisado; Termos de uso e Privacidade também faltam.
- As páginas têm `noindex,nofollow` de propósito durante o beta.

`docs/ESTUDIO_ENTRELINHAS_PLANO.md` é o reconhecimento feito **antes** do Estúdio existir (02/10/2026) e ficou como registro histórico; para saber o estado atual, use este README e o código.
