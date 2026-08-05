const express = require('express');
const db = require('../models/db');
const { requireAuth, requireActiveSubscription } = require('../middleware/auth');
const personalSheetController = require('../controllers/personalSheetController');

const router = express.Router();

router.use(requireAuth);
router.use(requireActiveSubscription);

const resolveProfileType = async (req) => {
  if (req.session?.profileType) return String(req.session.profileType);
  const user = await db.get('SELECT profile_type FROM users WHERE id = $1', [req.session.userId]);
  const profile = String(user?.profile_type || 'driver');
  req.session.profileType = profile;
  return profile;
};

const requirePersonalProfile = async (req, res, next) => {
  try {
    const profileType = await resolveProfileType(req);
    if (profileType !== 'personal') {
        return res.status(403).json({ error: 'Módulo disponível apenas para perfil pessoal.' });
    }
    return next();
  } catch (error) {
    return res.status(500).json({ error: 'Falha ao validar perfil do usuário.' });
  }
};

router.use(requirePersonalProfile);

router.get('/', personalSheetController.getSheet);
router.post('/rows', personalSheetController.createRow);
router.patch('/rows/:id', personalSheetController.renameRow);
router.delete('/rows/:id', personalSheetController.deleteRow);
router.put('/values', personalSheetController.putValues);

module.exports = router;
