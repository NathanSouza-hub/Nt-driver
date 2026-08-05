const { isSubscriptionActive } = require('./subscription');
const { serializeProfileType } = require('./profile-type');

const serializeUser = (user) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  isAdmin: Boolean(user.is_admin),
  profileType: serializeProfileType(user.profile_type),
  emailVerified: Boolean(user.email_verified_at) || !Boolean(user.email_verification_required),
  subscriptionStatus: user.subscription_status || 'trial',
  subscriptionActive: isSubscriptionActive(user),
  subscriptionTrialEndsAt: user.subscription_trial_ends_at || null
});

module.exports = { serializeUser };
