// Utilitario de desenvolvimento: captura do workspace com links, tags e conexoes. Uso: node tools/e2e/capturar-links.mjs <pasta>
import path from 'node:path';
import { iniciar } from './helpers.mjs';

const saida = path.resolve(process.argv[2] || '.');
const E2E = await iniciar();
try {
  const a = await E2E.novoAutor({ nome: 'Alex Kich' });
  const p = a.pagina;
  await p.goto(`${E2E.url}/estudio.html`);
  await p.click('#st-nova'); await p.click('.st-opcao:has-text("Escrever no Entrelinhas")');
  await p.fill('dialog input', 'O Que o Rio Esqueceu'); await p.click('dialog button:has-text("Criar obra")');
  await p.waitForSelector('.st-explorador .st-nome');
  const obra = p.url().match(/obra\/([a-f0-9]{12})/)[1];
  await p.evaluate(async (obra) => {
    const H = { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' };
    const w = await (await fetch(`/api/studio/works/${obra}`)).json();
    const pasta = (t) => w.itens.find((i) => i.doc_tipo === t).id;
    const mk = async (pai, titulo, tipo, corpo) => { const c = await (await fetch(`/api/studio/works/${obra}/docs`, { method: 'POST', headers: H, body: JSON.stringify({ pai, doc_tipo: tipo, titulo }) })).json(); if (corpo) await fetch(`/api/studio/works/${obra}/docs/${c.id}`, { method: 'PUT', headers: H, body: JSON.stringify({ versao_base: 1, corpo }) }); return c.id; };
    const kayla = await mk(pasta('personagens'), 'Kayla', 'personagem', 'Quinze anos. Filha de [[Márcia]]. #continuidade');
    await mk(pasta('personagens'), 'Márcia', 'personagem', 'Mãe de [[Kayla]]. Guarda um segredo sobre o [[Rio]].');
    await mk(pasta('mundo'), 'Rio', 'lugar', 'Corre atrás da casa. #pesquisar');
    await mk(pasta('manuscrito'), 'Capítulo 03', 'capitulo', '# O rio não esquece\n\nQuando [[Kayla]] desceu até a margem, [[Márcia]] já esperava. Nenhuma das duas falou da [[Regra dos Nomes]].\n\nO [[Rio]] seguia baixo. #revisar');
    await fetch(`/api/studio/works/${obra}/docs/${kayla}/tags`, { method: 'PUT', headers: H, body: JSON.stringify({ tags: ['protagonista'] }) });
  }, obra);
  await p.reload();
  await p.waitForSelector('.st-explorador .st-nome');
  await p.click('.st-nome:has-text("Capítulo 03")');
  await p.waitForSelector('.st-wikilink');
  await p.click('.st-pm .ProseMirror');
  await p.keyboard.press('Control+End');
  await p.keyboard.type(' Depois, [[Ka', { delay: 20 });
  await p.waitForSelector('.st-link-pop');
  await p.screenshot({ path: path.join(saida, '7-links.png') });
  await p.keyboard.press('Escape');
  await p.click('.st-nome:has-text("Kayla")');
  await p.waitForSelector('.st-contexto .st-lista-links');
  await p.screenshot({ path: path.join(saida, '8-conexoes.png') });
  await p.keyboard.press('Control+K'); await p.keyboard.type('marcia', { delay: 20 });
  await p.waitForSelector('.st-pal-item');
  await p.screenshot({ path: path.join(saida, '9-busca.png') });
  console.log('ok');
} finally { await E2E.parar(); }
