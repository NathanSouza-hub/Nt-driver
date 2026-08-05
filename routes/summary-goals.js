const express = require('express');
const { requireAuth, requireActiveSubscription } = require('../middleware/auth');
const summaryGoalsController = require('../controllers/summaryGoalsController');

const router = express.Router();

router.use(requireAuth);
router.use(requireActiveSubscription);

router.get('/:month', summaryGoalsController.getMonth);
router.put('/:month/:day', summaryGoalsController.setDay);

module.exports = router;
