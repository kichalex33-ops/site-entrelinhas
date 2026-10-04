# Estúdio Entrelinhas: plano (Fase 0, reconhecimento)

> **Documento histórico.** Descreve o projeto como era em 02/10/2026, **antes** de o Estúdio ser construído. Frases como "não existe editor", "não há testes" ou "a biblioteca não é alimentada pelo banco" eram verdade naquele dia e **não são mais**: hoje existem o editor com autosave, a publicação com declaração (ainda provisória), a vitrine vinda do D1 e as suítes `npm test` e `npm run e2e`. O estado atual está no [README](../README.md).

Data: 02/10/2026. Nada foi alterado no projeto antes deste documento.

## 1. Arquitetura encontrada

| Camada | Realidade no repositório |
|---|---|
| Hospedagem | Cloudflare Worker único (`src/index.js`, 552 linhas) + assets estáticos (`public/`), `run_worker_first: true` |
| Backend | JavaScript puro (ES modules), sem framework. Roteamento manual por `path`/`method` dentro de `fetch` |
| Banco | Cloudflare D1 (SQLite). Migrações em `migrations/0001..0005` aplicadas com `wrangler d1 migrations` |
| Frontend | HTML + JS puro, sem bundler, sem `package.json`, sem build. Cada página carrega `common.js` e seu script |
| Autenticação | Cookie `sid` (HttpOnly, Secure, SameSite=Strict), sessão em `sessions` (hash SHA-256 do token), senha PBKDF2, cabeçalho `X-Requested-With: fetch` obrigatório em escritas (CSRF), limite de tentativas em `login_fails` |
| Papéis | `users.role` = `autor` (cadastro por convite, tem perfil) ou `leitor` (cadastro aberto + Turnstile). `users.is_admin` = moderador (6 fundadores) |
| Obras hoje | Ficam dentro do JSON do perfil (`profiles.data.obras[]`: título, gênero, situação, sinopse, capa, link, lojas, `id` estável). Não existe tabela de obras, capítulos, rascunhos ou manuscrito |
| Biblioteca pública | `public/data.json` estático (10 livros de exemplo, `exemplo: true`) + perfis dos autores. Não é alimentada pelo banco |
| Imagens | Tabela `images` (BLOB no D1), até 600 KB cada, 30 por usuário, servidas **publicamente** em `/img/<id>` com cache imutável |
| Design system | `styles.css` (852 linhas) + `extra.css`. Tokens em `:root` (`--bg`, `--panel`, `--accent #d9a94a`, `--line`, `--radius`…), fontes Playfair Display + Inter. Componentes: `.btn(-primary/-ghost)`, `.fld`, `.blk`, `.item`, `.note`, `.hint`, `.badge-pill`, `.section-head`, `.eyebrow`, `.auth-box` |
| Logo | Wordmark em texto (`ENTRE<b>LINHAS</b>`). Não há raposa no repositório |
| Testes | Nenhum no repositório. Os 80+ testes feitos até aqui rodam em um harness externo (Worker contra SQLite em memória) e **não estão versionados** |
| Editor / autosave | Não existe. `conta.js` edita o perfil com formulário simples e botão "Salvar" |
| Declaração de autoria | **Não existe no código.** Só há a coluna `users.accepted_at` (migração 0003), sem nenhum uso. O texto "que já pertence ao projeto" não está neste repositório |

Código legado ou duplicado relacionado: `public/data.json` e `public/app.js` (vitrine de exemplo), `seed.sql` / `scripts/seed.mjs`. Nada disso será apagado nem tocado.

## 2. O que será reutilizado

- Autenticação, sessão, CSRF, `currentUser`, helpers (`json`, `fail`, `str`, `body`, `rand`, `toHex`, `now`) e o limite de tentativas.
- Papéis: o Estúdio é **só para `role = 'autor'`**.
- `common.js` (`EL.api`, `EL.esc`), cabeçalho/rodapé, `styles.css`/`extra.css` e as classes existentes. O Estúdio ganha só um `estudio.css` com o que for específico do workspace, usando os mesmos tokens.
- Padrão de migrações, `iniciar-local.bat`, deploy atual.
- Upload com redução no navegador (`shrink`) para imagens.

## 3. Divergências entre a especificação e a realidade (decisões)

| Ponto da especificação | Realidade | Decisão |
|---|---|---|
| "Declaração já pertence ao projeto" | Não existe | Cria-se a **estrutura** (tabela de aceites com versão da declaração). O texto jurídico **não é inventado**: entra um texto provisório, marcado como "a revisar", fácil de trocar por versão. Nada de salvar rascunho depende dele |
| Editor de biblioteca madura | Site sem build | ProseMirror (MIT), empacotado uma vez com esbuild em `public/vendor/estudio-editor.js` e **commitado**. O repositório continua sem build em produção. Ferramentas ficam em `tools/editor/` (devDependencies, fora do deploy) |
| Markdown como formato persistente | OK | Documento = Markdown (`prosemirror-markdown` + `markdown-it`). `[[links]]` viram um nó inline com serialização `[[Título]]` |
| Importar DOCX / exportar DOCX | Worker no plano gratuito tem **10 ms de CPU** por requisição | Importação e exportação são feitas **no navegador** (`mammoth` para DOCX→HTML→Markdown; `docx` para gerar DOCX). O servidor só recebe e entrega Markdown |
| Imagens privadas (HQ, ilustrações) | `images` é pública por id | Páginas de HQ e imagens do Estúdio ficam em tabela própria **servida com checagem de dono** (rascunho) ou pública só depois de publicada |
| Armazenamento de HQ | D1 limita 500 MB por banco no plano gratuito; R2 exige cartão | Páginas em BLOB no D1 com **cota por usuário** nesta fase. Migrar para R2 é decisão futura, documentada |
| Obras do perfil (JSON) × obras do Estúdio | Dois modelos | Convivem. Ao **publicar** uma obra do Estúdio, gera-se/atualiza a entrada correspondente no perfil (mesmo `id` de obra), para reviews, lojas e página do autor continuarem funcionando |
| Biblioteca pública estática | `data.json` | A leitura pública das obras publicadas ganha página própria (`ler.html`). Integração com a aba Biblioteca vem depois, sem quebrar a vitrine atual |
| Testes E2E | Não há framework | `playwright-core` (Apache-2.0) usando o **Chrome já instalado** (sem baixar navegador), em `tools/e2e/`. Testes de API continuam no harness SQLite, agora **versionado** em `tools/tests/` |

## 4. Banco de dados (novas tabelas, por migração)

Nenhuma tabela existente é alterada. Todas as novas ligam ao `users.id` do dono.

- **0006 núcleo:** `studio_works` (id hex, user_id, título, tipo `texto|hq|hibrida`, status, meta JSON, created/updated/deleted_at), `studio_docs` (id, work_id, parent_id, `kind` pasta|doc, `doc_type`, título, corpo Markdown, posição fracionária, `version` para controle otimista, contagem de palavras, deleted_at para lixeira), `studio_versions` (snapshots).
- **0007 conhecimento:** `studio_links` (de, para, título citado), `studio_doc_tags`.
- **0008 publicação:** `studio_declarations` (versão e texto), `studio_acceptances` (usuário, obra, versão, data), campos de publicação/agendamento em `studio_works`.
- **0009 HQ:** `studio_pages` (work_id, posição, mime, BLOB, tamanho), cota por usuário.

Autorização: **toda** consulta filtra por `user_id` da sessão, direto na obra, e documentos só são tocados via `work_id` já validado. Ids são aleatórios (12 hex) e **nunca** confiados sozinhos.

## 5. Arquivos

**Modificados (mínimo):** `src/index.js` (um despacho para `/api/studio/*`), `public/conta.js` e `public/autor.html` (link "Estúdio" para o dono), `iniciar-local.bat` (sem mudança prevista), `.gitignore`.

**Novos:** `src/studio.js` (API do Estúdio, módulo único para não inflar o `index.js`), `public/estudio.html`, `public/estudio.js`, `public/estudio.css`, `public/vendor/estudio-editor.js` (bundle), `migrations/0006..0009`, `tools/editor/` (fonte do bundle), `tools/tests/` (testes de API), `tools/e2e/` (testes no navegador), `docs/ESTUDIO_ENTRELINHAS_IMPLEMENTACAO.md`.

## 6. Segurança

- Dono da obra verificado em **cada** endpoint (anti-IDOR); respostas 404 (não 403) para obra de outro usuário, para não revelar existência.
- Conteúdo é Markdown/JSON; renderização sempre passa por esquema do ProseMirror ou `esc()`. Sem `innerHTML` com texto do usuário. Links só `http(s)`/`mailto`; imagens só do próprio Estúdio.
- Limites: tamanho de documento (1 MB), quantidade de documentos por obra e de obras por autor, taxa de escrita por usuário.
- Uploads: MIME e extensão em lista, tamanho máximo, nome gerado pelo servidor, nunca servido como HTML (`nosniff` + CSP `default-src 'none'`, como já é em `/img`).
- Rascunho nunca entra em `/api/authors`, perfil público, busca pública nem `data.json`.

## 7. Desempenho e limites

- Manuscrito **por documento**, carregado sob demanda. A lista da obra devolve só metadados (sem corpo).
- Autosave com debounce (~2 s), uma escrita por salvamento; snapshot só a cada ~10 min de edição, antes de publicar e sob pedido. Plano gratuito do D1: 100 mil linhas escritas por dia, então salvar é barato por desenho.
- Grafo e backlinks são calculados a partir de `studio_links` (índice), não do texto inteiro.

## 8. Autosave e consistência

`PUT` de documento envia `base_version`. Servidor aceita só se `version` coincide e devolve a nova; se não, responde **409** com a versão do servidor, e o cliente nunca sobrescreve em silêncio. Rascunho local (localStorage) por documento guarda o texto não confirmado e é reaplicado após queda de rede ou recarga.

## 9. Testes

- API: harness atual (Worker contra SQLite), movido para `tools/tests/` e rodando com `node --test`.
- E2E: Playwright com o Chrome instalado, contra o Worker real servido em memória (tools/e2e/helpers.mjs).
- Cobertura mínima conforme a seção 34 da especificação, incluindo acesso à obra de outro usuário.

## 10. Riscos

| Risco | Mitigação |
|---|---|
| Escopo enorme | Etapas pequenas, cada uma testada e commitada; MVP é o critério da seção 37 |
| Bundle do editor pesado | Carregar só na página do Estúdio; medir tamanho; remover o que não for usado |
| Perda de texto | 409 + rascunho local + snapshots; teste de queda de rede no E2E |
| Importação DOCX imperfeita | Passo "Conferir" antes de criar; arquivo original guardado |
| Declaração sem texto oficial | Estrutura pronta; texto provisório explícito; **você precisa aprovar o texto antes de publicar de verdade** |
| Cota do D1 | Cotas por usuário; plano de migração para R2 documentado |

## 11. Ordem de execução

1. Infra: migração 0006, API de obras/documentos, explorador, editor, autosave (+ testes).
2. Organização: pastas, tipos, abas, busca, tags.
3. `[[links]]`, autocomplete, backlinks.
4. Importar/exportar.
5. Publicação (metadados, capa, prévia, declaração, publicar/agendar, `ler.html`).
6. HQ.
7. Avançado (split, grafo, cronologia, histórico, Modo Entrelinhas).

Cada etapa só termina com testes passando e verificação real no navegador.
