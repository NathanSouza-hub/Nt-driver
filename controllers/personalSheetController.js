const personalSheetService = require('../services/personalSheetService');
const { sendError } = require('./helpers/handleError');

const getSheet = async (req, res) => {
  try {
    const payload = await personalSheetService.getSheet(req.session.userId, req.query?.year);
    res.json(payload);
  } catch (error) {
    sendError(res, error, 500, 'Falha ao carregar planilha pessoal.');
  }
};

const createRow = async (req, res) => {
  try {
    const payload = await personalSheetService.createRow(req.session.userId, req.body?.kind, req.body?.name);
    res.status(201).json(payload);
  } catch (error) {
    sendError(res, error, 500, 'Falha ao criar linha da planilha.');
  }
};

const renameRow = async (req, res) => {
  try {
    const payload = await personalSheetService.renameRow(req.session.userId, req.params.id, req.body?.name);
    res.json(payload);
  } catch (error) {
    sendError(res, error, 500, 'Falha ao atualizar linha da planilha.');
  }
};

const deleteRow = async (req, res) => {
  try {
    const payload = await personalSheetService.deleteRow(req.session.userId, req.params.id);
    res.json(payload);
  } catch (error) {
    sendError(res, error, 500, 'Falha ao excluir linha da planilha.');
  }
};

const putValues = async (req, res) => {
  try {
    const payload = await personalSheetService.applyValueUpdates(req.session.userId, req.body?.year, req.body?.updates);
    res.json(payload);
  } catch (error) {
    sendError(res, error, 500, 'Falha ao salvar valores da planilha.');
  }
};

module.exports = { getSheet, createRow, renameRow, deleteRow, putValues };
