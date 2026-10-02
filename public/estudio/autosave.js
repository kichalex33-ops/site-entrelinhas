// Autosave do Estudio: debounce, controle otimista de versao (409 nunca sobrescreve), tentativas com espera
// crescente e copia local de emergencia (localStorage) ate o servidor confirmar.
import { api } from './api.js';

const DEBOUNCE_MS = 1500;
const BACKUP_MS = 2000;
const ESPERAS = [3000, 6000, 12000, 30000, 60000];
const chave = (doc) => `estudio:rascunho:${doc.id}`;

const guardar = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* armazenamento cheio ou bloqueado */ } };
export const lerBackup = (docId) => { try { return JSON.parse(localStorage.getItem(`estudio:rascunho:${docId}`)); } catch { return null; } };
export const limparBackup = (docId) => { try { localStorage.removeItem(`estudio:rascunho:${docId}`); } catch { /* ok */ } };

// ctx: { obraId, corpoDe(doc) -> markdown atual, aoMudarEstado(), aoConflito(doc, atual), aoSalvo(doc, resposta) }
export function criarSalvador(ctx) {
  const docs = new Set();

  const estadoGeral = () => {
    let erro = null, salvando = false, pendente = false, conflito = false;
    for (const d of docs) {
      if (d.estado === 'conflito') conflito = true;
      else if (d.estado === 'erro') erro = d.erroMsg || 'Erro ao salvar';
      else if (d.estado === 'salvando') salvando = true;
      else if (d.dirty) pendente = true;
    }
    if (conflito) return { estado: 'conflito', texto: 'Conflito de edição' };
    if (erro) return { estado: 'erro', texto: erro };
    if (salvando) return { estado: 'salvando', texto: 'Salvando...' };
    if (pendente) return { estado: 'pendente', texto: 'Alterações pendentes...' };
    return { estado: 'salvo', texto: 'Salvo' };
  };
  const mudou = () => ctx.aoMudarEstado && ctx.aoMudarEstado(estadoGeral());
  const definir = (doc, estado, msg) => { doc.estado = estado; doc.erroMsg = msg || ''; mudou(); };

  function backupAgora(doc) {
    doc.backupEm = Date.now();
    guardar(chave(doc), { versao_base: doc.versao, titulo: doc.titulo, tipo: doc.tipo, corpo: ctx.corpoDe(doc), em: Date.now() });
  }

  function agendar(doc, ms) {
    clearTimeout(doc.timer);
    doc.timer = setTimeout(() => salvar(doc), ms);
  }

  function acompanhar(doc) {
    docs.add(doc);
    doc.rev = doc.rev || 0; doc.estado = doc.estado || 'salvo'; doc.tentativas = 0;
  }

  // chame a cada alteracao (digitacao, titulo, tipo)
  function marcar(doc) {
    acompanhar(doc);
    doc.rev++; doc.dirty = true;
    if (doc.estado === 'salvo') doc.estado = 'pendente';
    // copia local de emergencia, no maximo uma a cada 2 s
    if (!doc.backupTimer) {
      const espera = Math.max(0, BACKUP_MS - (Date.now() - (doc.backupEm || 0)));
      doc.backupTimer = setTimeout(() => { doc.backupTimer = null; if (doc.dirty) backupAgora(doc); }, espera);
    }
    if (doc.estado !== 'conflito') agendar(doc, doc.estado === 'erro' ? ESPERAS[Math.min(doc.tentativas, ESPERAS.length - 1)] : DEBOUNCE_MS);
    mudou();
  }

  async function salvar(doc, { keepalive = false } = {}) {
    if (!doc.dirty || doc.estado === 'conflito') return;
    if (doc.salvando) { doc.refazer = true; return; }
    clearTimeout(doc.timer);
    const rev = doc.rev;
    const corpo = ctx.corpoDe(doc);
    // garante a copia local ANTES de tentar a rede
    guardar(chave(doc), { versao_base: doc.versao, titulo: doc.titulo, tipo: doc.tipo, corpo, em: Date.now() });
    doc.salvando = true; definir(doc, 'salvando');
    try {
      const r = await api.salvarDoc(ctx.obraId, doc.id, { versao_base: doc.versao, titulo: doc.titulo, corpo, doc_tipo: doc.tipo }, keepalive && corpo.length < 50000);
      doc.versao = r.versao; doc.palavras = r.palavras; doc.atualizadoEm = r.atualizado_em; doc.tentativas = 0;
      if (doc.rev === rev) { doc.dirty = false; limparBackup(doc.id); definir(doc, 'salvo'); }
      else { definir(doc, 'pendente'); agendar(doc, 300); } // mudou enquanto enviava
      if (ctx.aoSalvo) ctx.aoSalvo(doc, r, corpo);
    } catch (e) {
      if (e.status === 409 && e.data && e.data.atual) { definir(doc, 'conflito'); ctx.aoConflito(doc, e.data.atual); }
      else if (e.status === 401) definir(doc, 'erro', 'Sessão expirada. Seu texto está guardado neste aparelho; entre de novo em outra aba.');
      else if ([400, 403, 404, 413].includes(e.status)) definir(doc, 'erro', e.message);
      else { // rede fora ou erro do servidor: tenta de novo com espera crescente
        definir(doc, 'erro', 'Sem conexão. Tentando de novo...');
        agendar(doc, ESPERAS[Math.min(doc.tentativas, ESPERAS.length - 1)]);
        doc.tentativas++;
      }
    } finally {
      doc.salvando = false;
      if (doc.refazer) { doc.refazer = false; if (doc.dirty && doc.estado !== 'conflito') agendar(doc, 0); }
    }
  }

  const todos = () => Promise.all([...docs].filter((d) => d.dirty).map((d) => salvar(d)));
  const emergencia = () => { for (const d of docs) if (d.dirty) { backupAgora(d); salvar(d, { keepalive: true }); } };

  window.addEventListener('online', () => { for (const d of docs) if (d.dirty && d.estado === 'erro') salvar(d); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') emergencia(); });
  window.addEventListener('pagehide', emergencia);
  window.addEventListener('beforeunload', (e) => {
    const g = estadoGeral();
    if (g.estado !== 'salvo') { emergencia(); e.preventDefault(); e.returnValue = ''; }
  });

  return {
    acompanhar, marcar, salvar, todos, estadoGeral,
    esquecer: (doc) => { clearTimeout(doc.timer); clearTimeout(doc.backupTimer); docs.delete(doc); mudou(); },
    // depois de resolver um conflito: libera o documento para voltar a salvar
    liberar(doc) { doc.estado = 'pendente'; mudou(); agendar(doc, 0); },
  };
}
