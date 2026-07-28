const isTrialActive = (user) => {
  if (!user?.subscription_trial_ends_at) return false;
  return new Date(user.subscription_trial_ends_at).getTime() > Date.now();
};

const isSubscriptionActive = (user) => {
  if (!user) return false;
  if (user.is_admin) return true;
  if (user.subscription_status === 'active') return true;
  return isTrialActive(user);
};

module.exports = { isTrialActive, isSubscriptionActive };
