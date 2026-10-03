// Inicia o Entrelinhas no computador (qualquer sistema): instala dependencias, prepara o banco
// local, cria as contas de teste, sobe o Worker e abre o navegador.
// Chamado por iniciar-local.bat (Windows) e iniciar-local.sh (Mac/Linux). Nada aqui toca o site real.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORTA = 8799;
const URL_SITE = `http://localhost:${PORTA}`;
const win = process.platform === 'win32';
const env = { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' };

function rodar(cmd, args, entrada) {
  const r = spawnSync(cmd, args, { cwd: raiz, env, shell: win && cmd === 'npm', stdio: [entrada ? 'pipe' : 'inherit', 'inherit', 'inherit'], input: entrada });
  if (r.status !== 0) { console.error(`\n  Falhou: ${cmd} ${args.join(' ')}`); process.exit(1); }
}
const passo = (s) => console.log(`\n  > ${s}`);

const [maior] = process.versions.node.split('.').map(Number);
if (maior < 20) { console.error(`  Node ${process.versions.node} é antigo demais. Instale o Node 20 ou mais novo: https://nodejs.org`); process.exit(1); }

if (!existsSync(join(raiz, 'node_modules', 'wrangler'))) {
  passo('Instalando dependências (só na primeira vez, pode levar alguns minutos)...');
  rodar('npm', ['install', '--no-audit', '--no-fund']);
}
const wrangler = join(raiz, 'node_modules', 'wrangler', 'bin', 'wrangler.js');

passo('Preparando o banco local...');
rodar(process.execPath, [wrangler, 'd1', 'migrations', 'apply', 'entrelinhas-db', '--local'], 'y\n');

passo('Criando as contas de teste...');
rodar(process.execPath, [join(raiz, 'scripts', 'dev-contas.mjs')]);
rodar(process.execPath, [wrangler, 'd1', 'execute', 'entrelinhas-db', '--local', '--file', join('.wrangler', 'dev-contas.sql')]);

passo(`Subindo o servidor em ${URL_SITE} ...`);
const dev = spawn(process.execPath, [wrangler, 'dev', '--local', '--port', String(PORTA)], { cwd: raiz, env, stdio: 'inherit' });
dev.on('exit', (c) => process.exit(c ?? 0));
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => dev.kill(s));

// abre o navegador quando o servidor responder
for (let i = 0; i < 120; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  try { await fetch(`${URL_SITE}/api/config`); } catch { continue; }
  const alvo = `${URL_SITE}/conta.html`;
  const abrir = win ? ['cmd', ['/c', 'start', '', alvo]] : process.platform === 'darwin' ? ['open', [alvo]] : ['xdg-open', [alvo]];
  spawn(abrir[0], abrir[1], { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
  console.log(`
  ==========================================================
   Entrelinhas rodando em ${URL_SITE}
   Login: ${alvo}

   Contas (senha de todas: entrelinhas123)
     alex@local.test    autor + moderador  -> /autor.html?a=alex-jr-kich
     autor@local.test   autor
     leitor@local.test  leitor

   Para parar: feche esta janela ou aperte Ctrl+C.
  ==========================================================
`);
  break;
}
