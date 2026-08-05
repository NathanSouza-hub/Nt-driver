const { AppError } = require('../errors/AppError');
const adminNotesRepository = require('../repositories/adminNotesRepository');

const MAX_CONTENT_SIZE = 500000;
const MAX_TITLE_SIZE = 120;
const DEFAULT_CONTENT_HTML = '<p></p>';
const DEFAULT_TITLE = 'Arquivo sem título';

const sanitizeHtml = (value) => {
  let html = String(value || '');

  // Remove blocos de script e elementos de incorporacao para manter o editor seguro.
  html = html.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '');
  html = html.replace(/<\/?(iframe|object|embed|link|meta|style)([^>]*)>/gi, '');

  // Remove atributos inline de evento e protocolos perigosos.
  html = html.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*')/gi, '');
  html = html.replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '');
  html = html.replace(/javascript\s*:/gi, '');

  return html;
};

const normalizeTitle = (value, fallback = DEFAULT_TITLE) => {
  const normalized = String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TITLE_SIZE);
  return normalized || fallback;
};

const serializeDocumentMeta = (row) => ({
  id: Number(row?.id || 0),
  title: normalizeTitle(row?.title),
  createdAt: row?.created_at || null,
  updatedAt: row?.updated_at || null
});

const serializeDocument = (row) => ({
  ...serializeDocumentMeta(row),
  contentHtml: row?.content_html || DEFAULT_CONTENT_HTML
});

const ensureAtLeastOneDocument = async (userId) => {
  const documents = await adminNotesRepository.listByUser(userId);
  if (documents.length) return documents;
  await adminNotesRepository.insertDocument(userId, normalizeTitle('Arquivo 1', 'Arquivo 1'));
  return adminNotesRepository.listByUser(userId);
};

const getNotes = async (userId, rawDocumentId) => {
  const documents = await ensureAtLeastOneDocument(userId);
  const requestedDocumentId = Number(rawDocumentId || 0);
  const selectedDocument = documents.find((document) => document.id === requestedDocumentId) || documents[0];
  const activeDocument = await adminNotesRepository.getById(userId, selectedDocument.id);

  return {
    documents: documents.map(serializeDocumentMeta),
    activeDocument: serializeDocument(activeDocument)
  };
};

const createNote = async (userId, rawTitle) => {
  const existingDocuments = await adminNotesRepository.listByUser(userId);
  const nextTitle = normalizeTitle(rawTitle, `Arquivo ${existingDocuments.length + 1}`);
  const createdDocument = await adminNotesRepository.insertDocument(userId, nextTitle);
  const documents = await adminNotesRepository.listByUser(userId);

  return {
    ok: true,
    documents: documents.map(serializeDocumentMeta),
    activeDocument: serializeDocument(createdDocument)
  };
};

const updateNote = async (userId, rawDocumentId, rawTitle, rawContentHtml) => {
  const documentId = Number(rawDocumentId);
  const rawContent = String(rawContentHtml || '');
  const normalizedTitle = normalizeTitle(rawTitle, DEFAULT_TITLE);

  if (!Number.isInteger(documentId) || documentId <= 0) {
    throw new AppError(400, 'Arquivo do bloco de notas inválido.');
  }
  if (rawContent.length > MAX_CONTENT_SIZE) {
    throw new AppError(400, 'Conteúdo muito grande para salvar.');
  }

  const sanitizedContent = sanitizeHtml(rawContent).trim() || DEFAULT_CONTENT_HTML;

  const existingDocument = await adminNotesRepository.getById(userId, documentId);
  if (!existingDocument) {
    throw new AppError(404, 'Arquivo do bloco de notas não encontrado.');
  }

  await adminNotesRepository.updateDocument(userId, documentId, normalizedTitle, sanitizedContent);

  const savedDocument = await adminNotesRepository.getById(userId, documentId);
  const documents = await adminNotesRepository.listByUser(userId);

  return {
    ok: true,
    documents: documents.map(serializeDocumentMeta),
    activeDocument: serializeDocument(savedDocument)
  };
};

const deleteNote = async (userId, rawDocumentId) => {
  const documentId = Number(rawDocumentId);

  if (!Number.isInteger(documentId) || documentId <= 0) {
    throw new AppError(400, 'Arquivo do bloco de notas inválido.');
  }

  const existingDocument = await adminNotesRepository.getById(userId, documentId);
  if (!existingDocument) {
    throw new AppError(404, 'Arquivo do bloco de notas não encontrado.');
  }

  await adminNotesRepository.deleteDocument(userId, documentId);

  let documents = await adminNotesRepository.listByUser(userId);
  let activeDocument = null;

  if (!documents.length) {
    activeDocument = await adminNotesRepository.insertDocument(userId, normalizeTitle('Arquivo 1', 'Arquivo 1'));
    documents = await adminNotesRepository.listByUser(userId);
  } else {
    activeDocument = await adminNotesRepository.getById(userId, documents[0].id);
  }

  return {
    ok: true,
    documents: documents.map(serializeDocumentMeta),
    activeDocument: serializeDocument(activeDocument)
  };
};

module.exports = {
  sanitizeHtml,
  normalizeTitle,
  serializeDocumentMeta,
  serializeDocument,
  getNotes,
  createNote,
  updateNote,
  deleteNote
};
