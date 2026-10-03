// SO PARA DESENVOLVIMENTO LOCAL: gera .wrangler/dev-contas.sql com contas de teste de senha conhecida.
// Uso: node scripts/dev-contas.mjs  e depois
//      wrangler d1 execute entrelinhas-db --local --file .wrangler/dev-contas.sql
// Nunca aplique no banco remoto (--remote): as senhas abaixo sao publicas.
import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const SENHA = 'entrelinhas123';
const PBKDF2_ITER = 100000; // igual a src/index.js
const t = Math.floor(Date.now() / 1000);
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

// perfil de Alex (mesmos dados do seed.sql)
const seed = readFileSync(new URL('../seed.sql', import.meta.url), 'utf8').split('\n')[0];

const contas = [
  { email: 'alex@local.test', slug: 'alex-jr-kich', role: 'autor', admin: 1, nome: 'Alex Jr. Kich' },
  { email: 'autor@local.test', slug: 'autor-teste', role: 'autor', admin: 0, nome: 'Autor Teste' },
  { email: 'leitor@local.test', slug: 'leitor-teste', role: 'leitor', admin: 0, nome: 'Leitor Teste' },
];

const perfilTeste = {
  nome: 'Autor Teste', frase: 'Perfil de teste do ambiente local.', local: '', bio: '', citacao: '',
  cor: '#d9a94a', fundo: 'preto', retrato: '', links: [], obras: [], secoes: [],
};

const sql = [seed.replace(/^INSERT INTO/, 'INSERT OR IGNORE INTO')];
sql.push(`INSERT OR IGNORE INTO profiles (slug, user_id, data, badges, published, updated_at) VALUES ('autor-teste', NULL, ${q(JSON.stringify(perfilTeste))}, '[]', 1, ${t});`);
for (const c of contas) {
  const salt = randomBytes(16);
  const hash = pbkdf2Sync(SENHA, salt, PBKDF2_ITER, 32, 'sha256').toString('base64');
  sql.push(
    `INSERT INTO users (email, pass_hash, pass_salt, slug, is_admin, created_at, accepted_at, role, nome) VALUES (${q(c.email)}, ${q(hash)}, ${q(salt.toString('base64'))}, ${q(c.slug)}, ${c.admin}, ${t}, ${t}, ${q(c.role)}, ${q(c.nome)}) ` +
    `ON CONFLICT(email) DO UPDATE SET pass_hash = excluded.pass_hash, pass_salt = excluded.pass_salt, is_admin = excluded.is_admin, role = excluded.role;`,
  );
  if (c.role === 'autor') sql.push(`UPDATE profiles SET user_id = (SELECT id FROM users WHERE email = ${q(c.email)}) WHERE slug = ${q(c.slug)};`);
}
sql.push('DELETE FROM login_fails;');

mkdirSync('.wrangler', { recursive: true });
writeFileSync('.wrangler/dev-contas.sql', sql.join('\n') + '\n');
console.log(`Contas locais (senha: ${SENHA}):`);
for (const c of contas) console.log(`  ${c.email.padEnd(20)} ${c.role}${c.admin ? ' + moderador' : ''}  /${c.slug}`);
