const express = require('express');
const { requireAuth, requireActiveSubscription } = require('../middleware/auth');
const personalExpensesController = require('../controllers/personalExpensesController');

const router = express.Router();

router.use(requireAuth);
router.use(requireActiveSubscription);

router.get('/', personalExpensesController.list);
router.post('/replace', personalExpensesController.replace);

module.exports = router;
