// Utilitario de desenvolvimento: gera capturas de tela do Estudio (nao e um teste).
// Uso: node tools/e2e/capturar.mjs <pasta-de-saida>
import path from 'node:path';
import { iniciar } from './helpers.mjs';

const saida = path.resolve(process.argv[2] || '.');
const E2E = await iniciar();
try {
  const a = await E2E.novoAutor({ nome: 'Alex Kich' });
  const p = a.pagina;
  await p.goto(`${E2E.url}/estudio.html`);
  await p.waitForSelector('#st-nova');
  await p.screenshot({ path: path.join(saida, '1-inicio-vazio.png') });
  await p.click('#st-nova');
  await p.screenshot({ path: path.join(saida, '2-nova-obra.png') });
  await p.click('.st-opcao:has-text("Escrever no Entrelinhas")');
  await p.fill('dialog input', 'O Que o Rio Esqueceu');
  await p.click('dialog button:has-text("Criar obra")');
  await p.waitForSelector('.st-explorador .st-nome');
  await p.hover('.st-linha:has-text("Manuscrito")');
  await p.click('button[aria-label="Novo documento em Manuscrito"]');
  await p.waitForSelector('.st-pm .ProseMirror');
  await p.click('.st-pm .ProseMirror');
  await p.keyboard.type('# O rio não esquece', { delay: 2 });
  await p.keyboard.press('Enter');
  await p.keyboard.type('Kayla desceu até a margem antes do sol. A água corria baixa, quase em silêncio, e levava com ela tudo o que a cidade havia decidido esquecer. ', { delay: 1 });
  await p.keyboard.type('Márcia a esperava com **as mãos frias** e uma pergunta que ninguém, naquela família, ousava fazer em voz alta.', { delay: 1 });
  await p.keyboard.press('Enter');
  await p.keyboard.type('> “O rio lembra o que a gente prefere perder.”');
  await p.keyboard.press('Enter'); await p.keyboard.press('Enter');
  await p.keyboard.type('---  ');
  await p.keyboard.type('Depois da cena, o silêncio.', { delay: 1 });
  await p.hover('.st-linha:has-text("Personagens")');
  await p.click('button[aria-label="Novo documento em Personagens"]');
  await p.waitForSelector('.st-aba:nth-child(2)');
  await p.fill('.st-titulo', 'Kayla');
  await p.click('.st-pm .ProseMirror'); await p.keyboard.type('Quinze anos. Observa tudo antes de falar.', { delay: 1 });
  await p.click('.st-aba-nome:has-text("Capítulo 01")');
  await p.waitForFunction(() => document.querySelector('.st-estado')?.dataset.estado === 'salvo', null, { timeout: 15000 });
  await p.screenshot({ path: path.join(saida, '3-workspace.png') });
  await p.click('#st-foco-btn');
  await p.screenshot({ path: path.join(saida, '4-foco.png') });
  await p.keyboard.press('Escape');
  await p.goto(`${E2E.url}/estudio.html`);
  await p.waitForSelector('.st-card');
  await p.screenshot({ path: path.join(saida, '5-lista.png') });
  const m = await E2E.novoAutor({ viewport: { width: 390, height: 800 } });
  await m.pagina.goto(`${E2E.url}/estudio.html`);
  await m.pagina.click('#st-nova'); await m.pagina.click('.st-opcao:has-text("Escrever no Entrelinhas")');
  await m.pagina.fill('dialog input', 'No celular'); await m.pagina.click('dialog button:has-text("Criar obra")');
  await m.pagina.waitForSelector('.st-bar');
  await m.pagina.click('#st-tg-exp');
  await m.pagina.screenshot({ path: path.join(saida, '6-celular-gaveta.png') });
  console.log('capturas em', saida);
} finally { await E2E.parar(); }
