const adminNotesService = require('../services/adminNotesService');
const { sendError } = require('./helpers/handleError');

const list = async (req, res) => {
  try {
    const payload = await adminNotesService.getNotes(req.session.userId, req.query?.documentId);
    res.json(payload);
  } catch (error) {
    sendError(res, error, 500, 'Falha ao carregar bloco de notas.');
  }
};

const create = async (req, res) => {
  try {
    const payload = await adminNotesService.createNote(req.session.userId, req.body?.title);
    res.status(201).json(payload);
  } catch (error) {
    sendError(res, error, 500, 'Falha ao criar arquivo do bloco de notas.');
  }
};

const update = async (req, res) => {
  try {
    const payload = await adminNotesService.updateNote(req.session.userId, req.params.documentId, req.body?.title, req.body?.contentHtml);
    res.json(payload);
  } catch (error) {
    sendError(res, error, 500, 'Falha ao salvar bloco de notas.');
  }
};

const remove = async (req, res) => {
  try {
    const payload = await adminNotesService.deleteNote(req.session.userId, req.params.documentId);
    res.json(payload);
  } catch (error) {
    sendError(res, error, 500, 'Falha ao apagar arquivo do bloco de notas.');
  }
};

module.exports = { list, create, update, remove };
