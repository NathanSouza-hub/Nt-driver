const express = require('express');
const { requireAuth, requireActiveSubscription } = require('../middleware/auth');
const recordsController = require('../controllers/recordsController');

const router = express.Router();

router.use(requireAuth);
router.use(requireActiveSubscription);

router.get('/', recordsController.list);
router.post('/', recordsController.create);
router.delete('/by-date/:date', recordsController.deleteByDate);
router.put('/:id', recordsController.update);
router.delete('/:id', recordsController.remove);

module.exports = router;
