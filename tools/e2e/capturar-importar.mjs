// Utilitario de desenvolvimento: captura da tela "Conferir" da importacao. Uso: node tools/e2e/capturar-importar.mjs <pasta>
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { iniciar } from './helpers.mjs';

const saida = path.resolve(process.argv[2] || '.');
const E2E = await iniciar();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'estudio-'));
try {
  const a = await E2E.novoAutor({ nome: 'Alex Kich' });
  const p = a.pagina;
  const txt = path.join(dir, 'O Que o Rio Esqueceu.txt');
  fs.writeFileSync(txt, ['Prólogo', 'O rio corria baixo naquela manhã, e ninguém na cidade quis lembrar por quê.', 'Capítulo 1', 'Kayla desceu até a margem antes do sol. A água levava tudo o que a cidade havia decidido esquecer.', 'Capítulo 2: A mãe', 'Márcia a esperava com as mãos frias e uma pergunta que ninguém ousava fazer.', 'Capítulo 3', 'Nenhuma das duas falou da Regra dos Nomes.', 'Epílogo', 'O rio seguiu.'].join('\n\n'));
  await p.goto(`${E2E.url}/estudio.html`);
  await p.click('#st-nova'); await p.click('.st-opcao:has-text("Importar manuscrito")');
  await p.screenshot({ path: path.join(saida, '10-importar-arquivo.png') });
  await p.setInputFiles('.st-drop-input', txt);
  await p.waitForSelector('.st-imp-lista');
  await p.screenshot({ path: path.join(saida, '11-importar-conferir.png') });
  await p.keyboard.press('Escape');
  console.log('ok');
} finally { await E2E.parar(); fs.rmSync(dir, { recursive: true, force: true }); }
