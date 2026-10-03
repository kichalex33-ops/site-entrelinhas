// Cliente da API privada do Estudio (/api/studio/*).
const J = { 'Content-Type': 'application/json' };
const base = '/api/studio/works';
const req = (method, url, body, extra) => window.EL.api(url, { method, headers: J, body: body === undefined ? undefined : JSON.stringify(body), ...(extra || {}) });

export const api = {
  me: () => window.EL.api('/api/me'),
  obras: () => req('GET', base),
  criarObra: (titulo, tipo) => req('POST', base, { titulo, tipo }),
  obra: (id) => req('GET', `${base}/${id}`),
  editarObra: (id, dados) => req('PATCH', `${base}/${id}`, dados),
  excluirObra: (id) => req('DELETE', `${base}/${id}`),
  restaurarObra: (id) => req('POST', `${base}/${id}/restore`),
  criarDoc: (obra, dados) => req('POST', `${base}/${obra}/docs`, dados),
  doc: (obra, doc) => req('GET', `${base}/${obra}/docs/${doc}`),
  // keepalive deixa o envio terminar mesmo se a pagina estiver fechando
  salvarDoc: (obra, doc, dados, keepalive) => req('PUT', `${base}/${obra}/docs/${doc}`, dados, keepalive ? { keepalive: true } : undefined),
  links: (obra, doc) => req('GET', `${base}/${obra}/docs/${doc}/links`),
  buscar: (obra, params) => req('GET', `${base}/${obra}/search?${params}`),
  tags: (obra, doc, tags) => req('PUT', `${base}/${obra}/docs/${doc}/tags`, { tags }),
  mover: (obra, doc, pai, posicao) => req('POST', `${base}/${obra}/docs/${doc}/move`, { pai, posicao }),
  duplicar: (obra, doc) => req('POST', `${base}/${obra}/docs/${doc}/duplicate`),
  paraLixeira: (obra, doc) => req('DELETE', `${base}/${obra}/docs/${doc}`),
  lixeira: (obra) => req('GET', `${base}/${obra}/trash`),
  restaurar: (obra, doc) => req('POST', `${base}/${obra}/docs/${doc}/restore`),
  apagarDefinitivo: (obra, doc) => req('DELETE', `${base}/${obra}/docs/${doc}?definitivo=1`),
  publicacao: (obra) => req('GET', `${base}/${obra}/publicacao`),
  publicar: (obra, dados) => req('POST', `${base}/${obra}/publicacao`, dados),
  despublicar: (obra) => req('DELETE', `${base}/${obra}/publicacao`),
  // capa: mesma rota de imagens do perfil (publica por id, ate 600 KB)
  enviarImagem: (blob) => window.EL.api('/api/image', { method: 'POST', headers: { 'Content-Type': blob.type }, body: blob }),
};
