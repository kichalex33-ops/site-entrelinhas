// Gera um convite e escreve convite.sql (so o hash vai para o banco).
//   node scripts/convite.mjs            -> convite de uso unico
//   node scripts/convite.mjs --universal -> convite reutilizavel (qualquer pessoa com o codigo cria conta)
// Depois aplique: wrangler d1 execute entrelinhas-db --remote --file convite.sql
// Para revogar um convite universal: wrangler d1 execute entrelinhas-db --remote --command "DELETE FROM invites WHERE reusable = 1"
import { createHash, randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const universal = process.argv.includes('--universal');
const ALF = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem I, O, 0, 1
const pick = (n) => [...randomBytes(n)].map((b) => ALF[b % ALF.length]).join('');
const code = universal ? `ENTRE-${pick(4)}-${pick(4)}-${pick(4)}` : `${pick(5)}-${pick(5)}-${pick(5)}`;
const hash = createHash('sha256').update(code).digest('hex');
const t = Math.floor(Date.now() / 1000);

writeFileSync('convite.sql', `INSERT INTO invites (code_hash, claim_slug, reusable, created_at) VALUES ('${hash}', NULL, ${universal ? 1 : 0}, ${t});\n`);
console.log(`${universal ? 'Convite universal' : 'Convite de uso unico'}: ${code}`);
