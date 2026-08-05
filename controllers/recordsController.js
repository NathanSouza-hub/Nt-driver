const recordsService = require('../services/recordsService');
const { sendError } = require('./helpers/handleError');

const list = async (req, res) => {
  try {
    const rows = await recordsService.listRecords(req.session.userId);
    res.json(rows);
  } catch (error) {
    sendError(res, error, 500, 'Falha ao carregar registros.');
  }
};

const create = async (req, res) => {
  try {
    const id = await recordsService.createRecord(req.session.userId, req.body || {});
    res.status(201).json({ id });
  } catch (error) {
    sendError(res, error, 500, 'Falha ao salvar registro.');
  }
};

const deleteByDate = async (req, res) => {
  try {
    const deleted = await recordsService.deleteRecordsByDate(req.session.userId, req.params.date);
    res.json({ deleted });
  } catch (error) {
    sendError(res, error, 500, 'Falha ao remover registros.');
  }
};

const update = async (req, res) => {
  try {
    const updated = await recordsService.updateRecord(req.params.id, req.session.userId, req.body || {});
    res.json({ updated });
  } catch (error) {
    sendError(res, error, 500, 'Falha ao atualizar registro.');
  }
};

const remove = async (req, res) => {
  try {
    const deleted = await recordsService.deleteRecord(req.params.id, req.session.userId);
    res.json({ deleted });
  } catch (error) {
    sendError(res, error, 500, 'Falha ao excluir registro.');
  }
};

module.exports = { list, create, deleteByDate, update, remove };
