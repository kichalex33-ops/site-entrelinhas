import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { iniciar } from './helpers.mjs';

let E2E;
before(async () => { E2E = await iniciar(); });
after(async () => { await E2E.parar(); });

test('lixeira: remover livro do perfil, restaurar e editar, remover de novo e excluir de vez', async () => {
  const a = await E2E.novoAutor({ nome: 'Ana Lixo' });
  const p = a.pagina;
  const obras = [{ id: 'abcdef000001', titulo: 'O Rio', genero: 'Fantasia', status: 'Publicado', sinopse: 'x', capa: '', link: '', lojas: [], faixa: '', publicado_em: '' }];
  E2E.app.db.prepare('UPDATE profiles SET data = ? WHERE slug = ?').run(JSON.stringify({ nome: 'Ana Lixo', frase: '', local: '', bio: '', citacao: '', cor: '#d9a94a', fundo: 'preto', retrato: '', links: [], secoes: [], obras }), a.slug);

  await p.goto(`${E2E.url}/conta.html`);
  await p.click('[data-rmobra="0"]');
  await p.click('dialog button:has-text("Remover")');
  await p.waitForSelector('#obras-blk :text("Nenhum livro divulgado ainda")');

  await p.click('#obras-blk a:has-text("Lixeira de livros")');
  await p.waitForSelector('.lx-item:has-text("O Rio")');
  assert.match(await p.innerText('.lx-prazo'), /Será excluído de vez em 15 dias/);
  await p.click('button:has-text("Restaurar e editar")');
  await p.waitForURL(/conta\.html#obra-abcdef000001/);
  await p.waitForSelector('dialog');
  assert.equal(JSON.parse(E2E.app.db.prepare('SELECT data FROM profiles WHERE slug = ?').get(a.slug).data).obras.length, 1, 'voltou ao perfil');

  await p.goto(`${E2E.url}/conta.html`);
  await p.click('[data-rmobra="0"]');
  await p.click('dialog button:has-text("Remover")');
  await p.waitForSelector('#obras-blk :text("Nenhum livro divulgado ainda")');
  await p.goto(`${E2E.url}/lixeira.html`);
  await p.click('[data-excluir]');
  await p.click('[data-definitivo]');
  await p.waitForSelector(':text("A lixeira está vazia")');
  assert.deepEqual(a.erros, []);
});
