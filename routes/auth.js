const express = require('express');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const authController = require('../controllers/authController');
const adminUserController = require('../controllers/adminUserController');
const subscriptionController = require('../controllers/subscriptionController');

const router = express.Router();

router.get('/register-status', authController.registerStatus);
router.post('/register', authController.register);
router.post('/login', authController.login);
router.post('/resend-verification', authController.resendVerification);
router.get('/verify-email', authController.verifyEmail);
router.post('/logout', authController.logout);
router.post('/change-password', requireAuth, authController.changePassword);
router.post('/change-name', requireAuth, authController.changeName);
router.post('/forgot-password', authController.forgotPassword);
router.post('/reset-password', authController.resetPassword);

router.get('/users', requireAdmin, adminUserController.list);
router.post('/users', requireAdmin, adminUserController.create);
router.post('/users/:id/reset-password', requireAdmin, adminUserController.resetPassword);
router.delete('/users/:id', requireAdmin, adminUserController.remove);
router.post('/users/:id/activate-subscription', requireAdmin, adminUserController.activateSubscription);

router.get('/subscription/pix-info', requireAuth, subscriptionController.pixInfo);
router.post('/subscription/notify-payment', requireAuth, subscriptionController.notifyPayment);

router.get('/me', requireAuth, authController.me);

module.exports = router;
