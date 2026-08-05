const { AppError } = require('../../errors/AppError');

const sendError = (res, error, fallbackStatus, fallbackMessage) => {
  if (error instanceof AppError) {
    return res.status(error.status).json({ error: error.message, ...error.extra });
  }
  return res.status(fallbackStatus).json({ error: fallbackMessage });
};

module.exports = { sendError };
