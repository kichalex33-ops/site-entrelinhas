import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { iniciar } from './helpers.mjs';

let E2E;
before(async () => { E2E = await iniciar(); });
after(async () => { await E2E.parar(); });

const perfil = (nome, obras = []) => JSON.stringify({ nome, frase: '', local: '', bio: '', citacao: '', cor: '#d9a94a', fundo: 'preto', retrato: '', links: [], obras, secoes: [] });

// PNG paisagem desenhado no proprio navegador (nenhuma imagem fica no repositorio)
async function pngPaisagem(p) {
  const b64 = await p.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 900; c.height = 500;
    const g = c.getContext('2d'); g.fillStyle = '#336'; g.fillRect(0, 0, 900, 500); g.fillStyle = '#d9a94a'; g.fillRect(300, 100, 300, 300);
    return c.toDataURL('image/png').split(',')[1];
  });
  return { name: 'paisagem.png', mimeType: 'image/png', buffer: Buffer.from(b64, 'base64') };
}
const proporcao = (loc) => loc.evaluate((img) => new Promise((ok) => (img.complete && img.naturalWidth ? ok() : img.addEventListener('load', ok, { once: true })))
  .then(() => img.naturalWidth / img.naturalHeight));

test('recorte: foto do autor sai 3:4, capa sai 2:3, e cancelar nao envia nada', async () => {
  const a = await E2E.novoAutor({ nome: 'Autora Recorte' });
  E2E.app.db.prepare('UPDATE profiles SET data = ? WHERE slug = ?').run(perfil('Autora Recorte'), a.slug);
  const p = a.pagina;
  await p.goto(`${E2E.url}/conta.html`);
  const img = await pngPaisagem(p);
  const imagens = () => E2E.app.db.prepare('SELECT COUNT(*) AS n FROM images').get().n;

  // cancelar: nada vai para o servidor
  const antes = imagens();
  await p.setInputFiles('input[data-up=retrato]', img);
  await p.locator('dialog.el-recorte .cropper-container').waitFor();
  await p.click('dialog.el-recorte button:has-text("Cancelar")');
  await p.locator('dialog.el-recorte').waitFor({ state: 'detached' });
  assert.equal(imagens(), antes);

  // foto de perfil: aproxima, usa, e a imagem enviada e 3:4
  await p.setInputFiles('input[data-up=retrato]', img);
  await p.locator('dialog.el-recorte .cropper-container').waitFor();
  await p.click('dialog.el-recorte button[title=Aproximar]');
  await p.click('dialog.el-recorte button:has-text("Usar esta imagem")');
  const foto = p.locator('#prev-retrato img');
  await foto.waitFor();
  assert.ok(Math.abs(await proporcao(foto) - 3 / 4) < 0.01);
  assert.equal(imagens(), antes + 1);

  // capa de livro divulgado: 2:3
  await p.click('button[data-novaobra]');
  await p.locator('dialog.el-dialogo .el-opcao:has-text("Divulgar livro de fora")').click();
  const dlg = p.locator('dialog.el-dialogo:has(h2:text("Divulgar livro"))');
  await dlg.locator('input[type=file]').setInputFiles(img);
  await p.locator('dialog.el-recorte .cropper-container').waitFor();
  await p.click('dialog.el-recorte button:has-text("Usar esta imagem")');
  const capa = dlg.locator('.obra-mini img');
  await capa.waitFor();
  assert.ok(Math.abs(await proporcao(capa) - 2 / 3) < 0.01);
  assert.deepEqual(a.erros, []);
});

test('busca da Biblioteca: titulo, autor e genero, sem acento e com erro de digitacao', async () => {
  const a = await E2E.novoAutor({ nome: 'Clara Busca' });
  const obra = (id, titulo, genero) => ({ id, titulo, genero, status: 'Publicado', sinopse: '', capa: '', link: '', lojas: [], faixa: 'L' });
  E2E.app.db.prepare('UPDATE profiles SET data = ?, published = 1 WHERE slug = ?').run(perfil('Clara Busca', [
    obra('o1', 'Neon Sobre a Cidade', 'Ficção Científica · Cyberpunk'),
    obra('o2', 'O Jardim das Avós', 'Romance'),
    obra('o3', 'Ossos do Inverno', 'Terror'),
  ]), a.slug);
  const p = a.pagina;
  await p.goto(`${E2E.url}/index.html#biblioteca`);
  await p.waitForSelector('#libraryGrid .book-card');
  const visiveis = () => p.$$eval('#libraryGrid .book-card', (ks) => ks.filter((k) => k.style.display !== 'none').map((k) => k.querySelector('h4').firstChild.textContent.trim()));
  const buscar = async (t) => { await p.fill('#buscaLivro', t); await p.waitForTimeout(150); return visiveis(); };

  assert.deepEqual(await buscar('ficcao cientifica'), ['Neon Sobre a Cidade']);
  assert.deepEqual(await buscar('cyberpnk'), ['Neon Sobre a Cidade']); // erro de digitacao
  assert.deepEqual(await buscar('jard'), ['O Jardim das Avós']); // comeco da palavra
  assert.equal((await buscar('clara')).length, 3); // autora
  assert.deepEqual(await buscar('xyzw'), []);
  assert.ok(await p.isVisible('#buscaVazia'));
  assert.equal((await buscar('')).length, 3);
  assert.ok(!(await p.isVisible('#buscaVazia')));
  assert.deepEqual(a.erros, []);
});
