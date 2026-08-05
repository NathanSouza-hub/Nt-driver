const PASSWORD_MIN_LENGTH = 8;

const getPasswordValidationErrors = (password) => {
  const rawPassword = String(password || '');
  const errors = [];

  if (rawPassword.length < PASSWORD_MIN_LENGTH) {
    errors.push(`A senha deve ter pelo menos ${PASSWORD_MIN_LENGTH} caracteres.`);
  }
  if (!/[a-z]/.test(rawPassword)) {
    errors.push('A senha deve ter ao menos uma letra minúscula.');
  }
  if (!/[A-Z]/.test(rawPassword)) {
    errors.push('A senha deve ter ao menos uma letra maiúscula.');
  }
  if (!/\d/.test(rawPassword)) {
    errors.push('A senha deve ter ao menos um número.');
  }
  if (!/[^A-Za-z0-9]/.test(rawPassword)) {
    errors.push('A senha deve ter ao menos um caractere especial.');
  }

  return errors;
};

const getPasswordValidationMessage = (password) => {
  const errors = getPasswordValidationErrors(password);
  return errors.length ? errors[0] : '';
};

module.exports = { PASSWORD_MIN_LENGTH, getPasswordValidationErrors, getPasswordValidationMessage };
