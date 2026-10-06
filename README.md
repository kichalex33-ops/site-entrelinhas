# site-entrelinhas

Site do **Entrelinhas**, coletivo de escritores independentes: [entrelinhasbr.com.br](https://entrelinhasbr.com.br).

Um Cloudflare Worker (`src/`) com banco D1 serve a API, e os arquivos de `public/` saem como estáticos. Não há etapa de build própria no deploy: o JavaScript do navegador é escrito à mão, e as bibliotecas de terceiros (ProseMirror, Mammoth, markdown-it, docx, Cropper.js, MiniSearch) são empacotadas uma vez em `public/vendor/` e versionadas. No servidor, o `wrangler deploy` empacota o `src/` com a única dependência de produção (`postal-mime`, para ler os e-mails do contato).

## O que o site faz hoje

| Área | Páginas | Servidor |
|---|---|---|
| Vitrine: página inicial, Biblioteca (com busca), Lançamentos, Projetos, Serviços | `index.html`, `app.js` | `src/vitrine.js` (livros), `src/site.js` (notícias, projetos, selos, serviços e contato, editáveis pelos moderadores) |
| Contas: login, cadastro de leitor (Turnstile) e de autor (por convite), aceite dos Termos, confirmação de e-mail, recuperar senha, apagar conta | `conta.html`, `conta.js`, `confirmar-email.html`, `recuperar.html`, `redefinir.html` | `src/index.js` |
| Primeiros passos de autor e leitor (em Minha conta) | `conta.js` | `src/onboarding.js` |
| Perfil público do autor (seguir, seguidores, nota média) e lista de autores | `autor.html`, `autores.html` | `src/index.js` (`profiles`) |
| Lista de leitores (só perfis públicos) e perfil de leitor: estantes, atividade, perfil privado | `leitores.html`, `leitor.html` | `src/leitor.js` |
| Estúdio: editor de manuscrito com autosave, notas, fichas, links `[[...]]`, tags, busca, importar/exportar DOCX/TXT/Markdown, publicar e agendar (declaração de autoria versionada) | `estudio.html`, `estudio/*.js` | `src/studio.js` |
| Leitura pública das obras publicadas (cópia feita ao publicar, não o rascunho) | `ler.html` | `src/leitura.js` |
| Página do livro: personagens, galeria, materiais, extras, avaliações, favoritos | `obra.html`, `reviews.js` | `src/livro.js` |
| Editor de capa e visualizador 3D | `editor-capa.html`, `visualizador-capa.html` | — |
| Comunidade: leitura beta, denúncias de livros e de avaliações, lixeira de livros, chat e painel da moderação | `ajuda.html`, `lixeira.html`, `chat.html`, `moderacao.js` | `src/ajuda.js`, `src/denuncias.js`, `src/lixeira.js` |
| Institucional: Sobre, Termos de Uso, Privacidade, Diretrizes da Comunidade, feedback do beta | `sobre.html`, `termos.html`, `privacidade.html`, `diretrizes.html`, `feedback.html` | `src/feedback.js` |
| Caixa do `contato@entrelinhasbr.com.br`, lida no painel da moderação | `moderacao.js` | `src/contato.js` (handler `email()`) |
| SEO: robots por página, canônico, JSON-LD, prévia de link, `/robots.txt`, `/sitemap.xml` | — | `src/meta.js` |

O banco é definido só pelas migrações em `migrations/` (aplicadas em ordem; migração antiga nunca é editada).

## Lançamento: `PUBLIC_LAUNCH`

`PUBLIC_LAUNCH` (em `wrangler.jsonc`) começa em `"off"`: todas as páginas saem `noindex` e o `robots.txt` não anuncia o sitemap. Com `"on"`, só as páginas públicas indexam (início, Autores, perfil de autor, livro, leitura, Sobre, Termos, Privacidade, Diretrizes); conta, Estúdio, lixeira, chat, senha, confirmação de e-mail, leitura beta e leitores ficam sempre `noindex`. A regra fica toda em `src/meta.js`; o `noindex` escrito nos arquivos de `public/` é só o padrão de segurança.

**Só mude para `"on"` depois do beta com pessoas reais.**

## Segurança, em resumo

- Sessão por cookie `HttpOnly; Secure; SameSite=Strict`; o banco guarda só o hash do token. Senhas com PBKDF2. Links de senha (30 min) e de confirmação de e-mail (48 h) são de uso único e também só ficam como hash.
- Toda escrita exige o cabeçalho `X-Requested-With: fetch` (CSRF), e o cadastro de leitor passa pelo Turnstile.
- Cabeçalhos em toda resposta (`comSeguranca` em `src/index.js`): CSP nas páginas (sem `unsafe-eval`; `unsafe-inline` ainda necessário), HSTS, `nosniff`, Referrer-Policy, Permissions-Policy e `frame-ancestors 'self'`. O teste `tools/e2e/csp.test.mjs` falha se a CSP bloquear algo que o site usa.
- Limites: tentativas de login/cadastro/recuperação/feedback (`login_fails`), reenvio de confirmação (1 por minuto, 3 por hora), limites diários por função e um **limite geral de escritas** por sessão/IP (`ESCRITAS` em `wrangler.jsonc`).
- Conta com e-mail pendente lê e navega, mas não publica, avalia, denuncia nem pede leitura beta (só vale com `RESEND_API_KEY` configurado). Contas de antes da confirmação ficam como `legado`, sem bloqueio.
- Tudo no Estúdio é filtrado pelo dono da obra; os testes cobrem acesso cruzado (IDOR).
- O HTML montado no navegador passa por `esc()`, e os links só aceitam `http(s)`. Uploads conferem o tamanho real e o tipo.

## Configuração fora do código

| O quê | Onde | Para quê |
|---|---|---|
| `RESEND_API_KEY` (segredo) | `npx wrangler secret put RESEND_API_KEY`, na conta Cloudflare do Entrelinhas | e-mails de recuperação de senha e de confirmação de conta. Sem ele, só o moderador gera link de senha e a confirmação de e-mail fica desligada |
| Domínio no Resend | painel do Resend: verificar `entrelinhasbr.com.br` (registros SPF/DKIM no DNS do Cloudflare) | o remetente `nao-responda@entrelinhasbr.com.br` (ou `RESET_FROM`) |
| Email Routing | Cloudflare > entrelinhasbr.com.br > Email > Email Routing: ativar; endereço de destino `entrelinhas.comm@protonmail.com` verificado; regra `contato@` → "Send to a Worker" → `entrelinhas` | caixa do contato no painel da moderação, com cópia no Proton (`CONTATO_COPIA`) |
| `TURNSTILE_SECRET` (segredo) | `wrangler secret put` | captcha do cadastro de leitor |
| robots.txt gerenciado | Cloudflare > Security > Bots / "Manage robots.txt" | se estiver ligado, o Cloudflare junta o texto dele ao `/robots.txt` do site |

## Rodar e testar

```sh
npm ci
npm test            # testes de unidade e da API (Worker real + SQLite em memória)
npm run e2e         # testes no navegador (usa o Chrome instalado; CHROME_PATH se estiver em outro lugar)
npm run build:editor  # só depois de mexer em tools/editor/ ou atualizar bibliotecas: regenera public/vendor/
```

As jornadas completas de leitor e autor (`tools/e2e/jornada-*.test.mjs`) simulam o Resend dentro do processo de teste: nenhum e-mail sai de verdade.

## Deploy

Push na `main` → GitHub Actions (`.github/workflows/deploy.yml`):
**testes de unidade + navegador → migrações do D1 → `wrangler deploy` → conferência do site no ar** (`tools/smoke.mjs`, só leitura).
Se um teste falha, nada vai para produção. Pull requests rodam só os testes.

Os testes de navegador rodam pelo `tools/e2e/rodar.mjs`: um arquivo que falha roda de novo uma vez, sozinho, e se passar aparece no log como **instável**. Alguns testes do Estúdio e da lixeira estouram o tempo de espera de vez em quando sob carga (sempre um diferente); a causa ainda não foi achada.

O site fica na conta Cloudflare do Entrelinhas, não na do Sinal/Ruído. Não rode `wrangler deploy` local sem conferir `wrangler whoami`. Mudanças em dados de produção também vão por migração.

## Pendências conhecidas

- `RESEND_API_KEY` não está configurado em produção (06/10/2026): recuperação de senha por e-mail e confirmação de e-mail ficam desligadas até configurar (ver tabela acima).
- Não há botão para suspender conta: hoje o encerramento por moderação é manual.
- Os textos de Termos, Privacidade e Diretrizes foram escritos para o Entrelinhas, mas não passaram por revisão jurídica.
- `PUBLIC_LAUNCH` continua `"off"` até o beta com usuários reais.

`docs/ESTUDIO_ENTRELINHAS_PLANO.md` é o reconhecimento feito **antes** do Estúdio existir (02/10/2026) e ficou como registro histórico; para saber o estado atual, use este README e o código.
