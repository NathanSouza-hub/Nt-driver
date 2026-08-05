const { AppError } = require('../errors/AppError');
const recordsRepository = require('../repositories/recordsRepository');

const listRecords = (userId) => recordsRepository.listByUser(userId);

const createRecord = (userId, fields) => recordsRepository.create(userId, fields);

const deleteRecordsByDate = (userId, rawDate) => {
  const date = decodeURIComponent(rawDate || '').trim();
  if (!date) {
    throw new AppError(400, 'Data inválida.');
  }
  return recordsRepository.deleteByDate(userId, date);
};

const updateRecord = (id, userId, fields) => recordsRepository.updateById(id, userId, fields);

const deleteRecord = (id, userId) => recordsRepository.deleteById(id, userId);

module.exports = { listRecords, createRecord, deleteRecordsByDate, updateRecord, deleteRecord };
