// Recorte de imagem antes do envio (capa do livro, foto do autor, foto do leitor), com Cropper.js.
// So carrega quando alguem escolhe uma imagem. Devolve um JPEG ja no formato da vitrine, ou null se cancelar;
// a reducao para caber nos 600 KB do servidor continua com quem chamou (shrink / enviarImagem).
import Cropper from 'cropperjs';
import css from 'cropperjs/dist/cropper.min.css';

const ESTILO = `${css}
dialog.el-recorte{margin:auto;background:var(--panel-2,#1b1b20);color:var(--text,#ececec);border:1px solid var(--line-strong,#333);border-radius:14px;padding:1.2rem;width:min(640px,96vw);max-height:96vh;overflow:auto;box-shadow:0 20px 60px rgba(0,0,0,.7)}
dialog.el-recorte::backdrop{background:rgba(0,0,0,.75)}
.el-recorte h2{font-family:'Playfair Display',serif;font-weight:500;font-size:1.25rem;margin:0 0 .4rem}
.el-recorte p{font-size:.85rem;color:var(--muted,#a8a8b0);margin:0 0 .8rem}
.el-recorte-area{height:min(55vh,460px);background:#000;border-radius:8px;overflow:hidden}
.el-recorte-area img{display:block;max-width:100%}
.el-recorte-zoom{display:flex;flex-wrap:wrap;gap:.4rem;justify-content:center;margin:.8rem 0}
.el-recorte-zoom .btn{padding:.45rem .9rem;min-width:2.6rem}
.el-recorte .cropper-view-box{outline-color:var(--accent,#d9a94a)}
.el-recorte .cropper-line,.el-recorte .cropper-point{background-color:var(--accent,#d9a94a)}
.el-recorte-rodape{display:flex;gap:.6rem;justify-content:flex-end;flex-wrap:wrap}
.el-recorte.redondo .cropper-view-box,.el-recorte.redondo .cropper-face{border-radius:50%}`;

let estiloPosto = false;
function porEstilo() {
  if (estiloPosto) return;
  const s = document.createElement('style'); s.textContent = ESTILO; document.head.append(s); estiloPosto = true;
}

const botao = (rotulo, classe, acao, extra = {}) => {
  const b = document.createElement('button'); b.type = 'button'; b.className = 'btn ' + classe; b.textContent = rotulo;
  Object.assign(b, extra); b.addEventListener('click', acao); return b;
};

// proporcao: largura/altura (capa 2/3, retrato 3/4, foto redonda 1). largura: tamanho do JPEG gerado.
export function recortar(arquivo, { proporcao = 2 / 3, largura = 1000, titulo = 'Ajustar imagem', redondo = false } = {}) {
  if (!/^image\/(jpeg|png|webp)$/.test(arquivo.type)) return Promise.reject(new Error('Envie uma imagem JPEG, PNG ou WebP.'));
  porEstilo();
  return new Promise((resolve) => {
    const url = URL.createObjectURL(arquivo);
    const dlg = document.createElement('dialog');
    dlg.className = 'el-recorte' + (redondo ? ' redondo' : '');
    const h2 = document.createElement('h2'); h2.textContent = titulo;
    const dica = document.createElement('p'); dica.textContent = 'Arraste a imagem para enquadrar e use a roda do mouse, o gesto de pinça ou os botões para aproximar.';
    const area = document.createElement('div'); area.className = 'el-recorte-area';
    const img = document.createElement('img'); img.alt = ''; area.append(img);
    let cropper = null, valor = null;

    const zoom = document.createElement('div'); zoom.className = 'el-recorte-zoom';
    zoom.append(
      botao('−', 'btn-ghost', () => cropper && cropper.zoom(-0.1), { title: 'Afastar', ariaLabel: 'Afastar' }),
      botao('+', 'btn-ghost', () => cropper && cropper.zoom(0.1), { title: 'Aproximar', ariaLabel: 'Aproximar' }),
      botao('↻', 'btn-ghost', () => cropper && cropper.rotate(90), { title: 'Girar', ariaLabel: 'Girar 90 graus' }),
      botao('Recomeçar', 'btn-ghost', () => cropper && cropper.reset()));

    const usar = botao('Usar esta imagem', 'btn-primary', async () => {
      if (!cropper) return;
      usar.disabled = true;
      const c = cropper.getCroppedCanvas({ width: largura, height: Math.round(largura / proporcao), fillColor: '#000', imageSmoothingQuality: 'high' });
      valor = c ? await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.92)) : null;
      dlg.close();
    });
    const rodape = document.createElement('div'); rodape.className = 'el-recorte-rodape';
    rodape.append(botao('Cancelar', 'btn-ghost', () => dlg.close()), usar);

    dlg.append(h2, dica, area, zoom, rodape);
    dlg.addEventListener('close', () => {
      if (cropper) cropper.destroy();
      URL.revokeObjectURL(url); dlg.remove();
      resolve(valor ? new File([valor], 'imagem.jpg', { type: 'image/jpeg' }) : null);
    });
    document.body.append(dlg);
    dlg.showModal();
    img.addEventListener('load', () => {
      cropper = new Cropper(img, {
        aspectRatio: proporcao, viewMode: 1, dragMode: 'move', autoCropArea: 1,
        guides: false, center: false, background: false, toggleDragModeOnDblclick: false,
      });
    }, { once: true });
    img.src = url;
  });
}
