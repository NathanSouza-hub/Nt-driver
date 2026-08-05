const express = require('express');
const { requireAdmin } = require('../middleware/auth');
const adminNotesController = require('../controllers/adminNotesController');

const router = express.Router();

router.get('/', requireAdmin, adminNotesController.list);
router.post('/', requireAdmin, adminNotesController.create);
router.put('/:documentId', requireAdmin, adminNotesController.update);
router.delete('/:documentId', requireAdmin, adminNotesController.remove);

module.exports = router;
