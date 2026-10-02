import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeApp } from './helpers.mjs';

const base = '/api/studio/works';

async function cenario() {
  const app = makeApp(); const a = app.addUser();
  const w = (await app.call('POST', base, { tok: a.tok, body: { titulo: 'Rio' } })).j.id;
  // upload binario (o helper `call` so envia JSON)
  const subir = async (nome, bytes, { tok = a.tok, obra = w } = {}) => {
    const r = await app.worker.fetch(new Request(`https://t${base}/${obra}/files?nome=${encodeURIComponent(nome)}`, {
      method: 'POST', headers: { 'X-Requested-With': 'fetch', 'Content-Type': 'application/octet-stream', 'Content-Length': String(bytes.length), Cookie: 'sid=' + tok }, body: bytes,
    }), app.env);
    return { s: r.status, j: await r.json().catch(() => null) };
  };
  const baixar = async (id, { tok = a.tok, obra = w } = {}) => app.worker.fetch(new Request(`https://t${base}/${obra}/files/${id}`, { headers: { Cookie: 'sid=' + tok } }), app.env);
  return { app, a, w, subir, baixar };
}
const docxFalso = (n = 200) => { const b = new Uint8Array(n); b[0] = 0x50; b[1] = 0x4b; for (let i = 2; i < n; i++) b[i] = (i * 7) % 251 || 1; return b; };

test('guardar o arquivo original: lista, baixa os mesmos bytes e entrega como anexo seguro', async () => {
  const { app, a, w, subir, baixar } = await cenario();
  const bytes = docxFalso(5000);
  const r = await subir('O Que o Rio Esqueceu.docx', bytes);
  assert.equal(r.s, 201); assert.equal(r.j.tamanho, 5000);
  const lista = (await app.call('GET', `${base}/${w}/files`, { tok: a.tok })).j.arquivos;
  assert.equal(lista.length, 1); assert.equal(lista[0].nome, 'O Que o Rio Esqueceu.docx');
  const d = await baixar(r.j.id);
  assert.equal(d.status, 200);
  assert.deepEqual(new Uint8Array(await d.arrayBuffer()), bytes, 'bytes identicos');
  assert.match(d.headers.get('Content-Disposition'), /^attachment; filename\*=UTF-8''O%20Que%20o%20Rio/);
  assert.equal(d.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.match(d.headers.get('Content-Security-Policy'), /sandbox/);
  assert.equal(d.headers.get('Cache-Control'), 'private, no-store');
});

test('txt e markdown sao aceitos; formatos e conteudos invalidos sao recusados', async () => {
  const { subir } = await cenario();
  const enc = new TextEncoder();
  assert.equal((await subir('a.txt', enc.encode('Capítulo 1\n\nTexto.'))).s, 201);
  assert.equal((await subir('b.md', enc.encode('# Título\n\ntexto'))).s, 201);
  assert.equal((await subir('c.exe', enc.encode('MZ'))).s, 400, 'extensao nao aceita');
  assert.equal((await subir('d.html', enc.encode('<script>x</script>'))).s, 400);
  assert.equal((await subir('sem-extensao', enc.encode('x'))).s, 400);
  assert.equal((await subir('falso.docx', enc.encode('isto nao e um zip'))).s, 400, 'docx precisa do cabecalho PK');
  assert.equal((await subir('binario.txt', new Uint8Array([65, 0, 66, 67]))).s, 400, 'txt com byte nulo e binario');
  assert.equal((await subir('vazio.txt', new Uint8Array(0))).s, 400);
});

test('limites: 1,5 MB por arquivo e 5 arquivos por obra', async () => {
  const { subir } = await cenario();
  assert.equal((await subir('grande.docx', docxFalso(1500001))).s, 413);
  assert.equal((await subir('limite.docx', docxFalso(1500000))).s, 201);
  for (let i = 0; i < 4; i++) assert.equal((await subir(`f${i}.docx`, docxFalso(300))).s, 201);
  const r = await subir('sexto.docx', docxFalso(300));
  assert.equal(r.s, 403);
  assert.match(r.j.erro, /5 arquivos/);
});

test('nome do arquivo e sanitizado (sem caminho, sem caracteres de controle)', async () => {
  const { app, a, w, subir } = await cenario();
  const r = await subir('..\\..\\etc/passwd\u0001:*?.txt', new TextEncoder().encode('x'));
  assert.equal(r.s, 201);
  const nome = (await app.call('GET', `${base}/${w}/files`, { tok: a.tok })).j.arquivos[0].nome;
  assert.ok(!/[\\/:*?"<>|\u0001]/.test(nome), nome);
  assert.ok(nome.endsWith('.txt'));
});

test('privacidade: outro autor nao lista, nao baixa e nao apaga; apagar remove', async () => {
  const { app, a, w, subir, baixar } = await cenario();
  const r = await subir('segredo.txt', new TextEncoder().encode('conteudo privado'));
  const b = app.addUser();
  assert.equal((await app.call('GET', `${base}/${w}/files`, { tok: b.tok })).s, 404);
  assert.equal((await baixar(r.j.id, { tok: b.tok })).status, 404);
  assert.equal((await app.call('DELETE', `${base}/${w}/files/${r.j.id}`, { tok: b.tok })).s, 404);
  assert.equal((await subir('invasor.txt', new TextEncoder().encode('x'), { tok: b.tok })).s, 404, 'nao sobe arquivo na obra alheia');
  // o autor da obra B nao acessa o arquivo da obra A usando o caminho da propria obra
  const wb = (await app.call('POST', base, { tok: b.tok, body: { titulo: 'B' } })).j.id;
  assert.equal((await baixar(r.j.id, { tok: b.tok, obra: wb })).status, 404);
  assert.equal((await app.call('DELETE', `${base}/${w}/files/${r.j.id}`, { tok: a.tok })).s, 200);
  assert.equal((await baixar(r.j.id)).status, 404);
  // sem login
  assert.equal((await app.worker.fetch(new Request(`https://t${base}/${w}/files`, { headers: { 'X-Requested-With': 'fetch' } }), app.env)).status, 401);
});

test('o upload tambem exige o cabecalho CSRF', async () => {
  const { app, a, w } = await cenario();
  const r = await app.worker.fetch(new Request(`https://t${base}/${w}/files?nome=a.txt`, { method: 'POST', headers: { Cookie: 'sid=' + a.tok }, body: 'x' }), app.env);
  assert.equal(r.status, 403);
});
