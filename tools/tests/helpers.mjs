// Harness de testes: roda o Worker de verdade (src/index.js) contra um SQLite em memoria
// com as migracoes reais, simulando a API do D1. Sem rede, sem Cloudflare.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { default: worker } = await import(path.join(raiz, 'src', 'index.js').replace(/\\/g, '/').replace(/^([A-Za-z]):/, 'file:///$1:'));

export function createD1(db) {
  const wrap = (sql) => {
    let args = [];
    const o = {
      bind: (...a) => ((args = a), o),
      all: async () => ({ results: db.prepare(sql).all(...args) }),
      first: async () => db.prepare(sql).get(...args) ?? null,
      run: async () => {
        const r = db.prepare(sql).run(...args);
        return { success: true, meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } };
      },
    };
    return o;
  };
  return { prepare: wrap, batch: async (stmts) => { const out = []; for (const s of stmts) out.push(await s.run()); return out; } };
}

const sha = (s) => createHash('sha256').update(s).digest('hex');

// Cria um app novo (banco limpo). Retorna utilitarios para os testes.
export function makeApp(extraEnv = {}) {
  const db = new DatabaseSync(':memory:');
  const dir = path.join(raiz, 'migrations');
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) db.exec(readFileSync(path.join(dir, f), 'utf8'));
  const env = { DB: createD1(db), ASSETS: { fetch: async () => new Response('asset') }, ...extraEnv };
  let nextId = 1;

  // usuario + sessao direta no banco (a senha nao importa nos testes de API)
  const addUser = ({ role = 'autor', mod = false, nome = 'Autor' } = {}) => {
    const id = nextId++;
    const slug = (role === 'leitor' ? 'leitor-' : 'autor-') + id;
    db.prepare('INSERT INTO users (id, email, pass_hash, pass_salt, slug, is_admin, created_at, role, nome) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, `u${id}@teste.local`, 'x', 'x', slug, mod ? 1 : 0, 1, role, role === 'leitor' ? nome : '');
    if (role === 'autor') db.prepare('INSERT INTO profiles (slug, user_id, data, badges, published, updated_at) VALUES (?, ?, ?, ?, 1, 1)').run(slug, id, JSON.stringify({ nome, obras: [] }), '[]');
    const tok = `tok-${id}-${Math.random().toString(16).slice(2)}`;
    db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(sha(tok), id, 9999999999);
    return { id, slug, tok };
  };

  const call = async (method, urlPath, { tok, body, ip = '1.1.1.1', host = 't' } = {}) => {
    const h = { 'X-Requested-With': 'fetch', 'Content-Type': 'application/json', 'CF-Connecting-IP': ip };
    if (tok) h.Cookie = 'sid=' + tok;
    const r = await worker.fetch(new Request('https://' + host + urlPath, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' }), env);
    let j = null; try { j = await r.clone().json(); } catch { /* resposta sem JSON */ }
    return { s: r.status, j, headers: r.headers };
  };
  return { db, env, addUser, call, worker };
}
