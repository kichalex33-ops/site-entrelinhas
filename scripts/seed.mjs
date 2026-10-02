// Gera seed.sql: perfil inicial de Alex Jr. Kich + um convite que reivindica esse perfil.
// Uso: node scripts/seed.mjs  (imprime o codigo do convite uma unica vez)
import { createHash, randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const slug = 'alex-jr-kich';
const profile = {
  nome: 'Alex Jr. Kich',
  frase: 'Escritor, artista e criador de mundos.',
  local: 'Rio Grande do Sul',
  bio: 'Desenho, componho e escrevo histórias em escalas muito diferentes: algumas olham para o céu, outras constroem mundos inteiros, outras cabem debaixo de uma cama.',
  citacao: 'O conceito pode ser enorme, mas o conflito precisa continuar humano.',
  cor: '#d9a94a',
  fundo: 'preto',
  retrato: '/autor/retrato.jpg',
  links: [
    { rotulo: 'Site do autor', url: 'https://sinalruido.com.br/' },
    { rotulo: 'Instagram', url: 'https://www.instagram.com/sinal_ruido/' },
    { rotulo: 'Amazon', url: 'https://www.amazon.ca/stores/ALEX-JR.-KICH/author/B0HH718W4M' },
  ],
  obras: [
    { titulo: 'SINAL/RUÍDO', genero: 'Ficção científica', status: 'Publicado', capa: '/autor/capa.jpg', link: 'https://sinalruido.com.br/livros/sinal-ruido/',
      sinopse: 'Um sinal real captado em 1977. Uma pergunta que nunca foi embora.' },
    { titulo: 'Os Deuses Não Têm Filhos', genero: 'Crônicas Cosmológicas · Livro I', status: 'Publicado', capa: '/autor/os-deuses-nao-tem-filhos.jpg', link: 'https://sinalruido.com.br/livros/os-deuses-nao-tem-filhos/',
      sinopse: 'Dez histórias independentes ligadas por algo que registra pessoas, acontecimentos e versões da realidade.' },
    { titulo: 'Duas Irmãs e Oito Patas', genero: 'Literatura infantil · Livro 1', status: 'Publicado', capa: '/autor/duas-irmas-capa.jpg', link: 'https://www.amazon.com.br/dp/B0HGMMSBSX',
      sinopse: 'Duas meninas, dois cães e a suspeita de que uma casa comum pode esconder muito mais do que parece.' },
    { titulo: 'VALANDOR', genero: 'Fantasia · Livro I', status: 'Em desenvolvimento', capa: '', link: '',
      sinopse: 'Um mundo onde os rios lembram. O Livro I está disponível em inglês como What the River Forgot. Nova edição em português em desenvolvimento.' },
  ],
  secoes: [
    { titulo: 'Histórias que começam pequenas',
      texto: 'Uma fotografia. Uma ausência. Uma criança que sabe alguma coisa que não deveria saber. Um sinal. Um rio. Um mapa esquecido debaixo da cama.\n\nA partir daí, a história pode crescer o quanto precisar. Mas alguém precisa continuar no centro, tentando entender o que está acontecendo.\n\nUma estrela que desaparece é um fenômeno. Uma mãe que percebe que o mundo inteiro esqueceu que o filho dela existiu, isso é uma história. É essa diferença que eu procuro.' },
    { titulo: 'Como eu escrevo',
      texto: 'Sempre me interessei por sistemas. Principalmente quando funcionam exatamente como deveriam e, ainda assim, alguma coisa dá errado.\n\nNão começo pelas regras. Começo procurando alguém que será atingido por elas. Posso escrever sobre um sinal vindo do espaço, um mundo de fantasia e duas meninas seguindo um mapa pelo quintal sem considerar essas histórias incompatíveis.\n\nA escala muda. A pessoa no centro, não.' },
  ],
};

const code = randomBytes(10).toString('hex').toUpperCase().match(/.{5}/g).join('-');
const hash = createHash('sha256').update(code).digest('hex');
const q = (s) => `'${s.replace(/'/g, "''")}'`;
const t = Math.floor(Date.now() / 1000);

writeFileSync('seed.sql', [
  `INSERT INTO profiles (slug, user_id, data, badges, published, updated_at) VALUES (${q(slug)}, NULL, ${q(JSON.stringify(profile))}, ${q(JSON.stringify(['Fundador']))}, 1, ${t});`,
  `INSERT INTO invites (code_hash, claim_slug, created_at) VALUES (${q(hash)}, ${q(slug)}, ${t});`,
].join('\n') + '\n');
console.log('seed.sql gerado. Convite para reivindicar o perfil de Alex:', code);
