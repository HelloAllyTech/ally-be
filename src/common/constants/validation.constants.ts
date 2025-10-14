export const PASSWORD_VALIDATION = {
  REGEX: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{6,}$/,
  MESSAGE:
    'Password must contain at least one uppercase letter, one lowercase letter, one number and one special character',
  MIN_LENGTH: 6,
};

export const PHONE_NUMBER_VALIDATION = {
  REGEX: /^\+?[\d\s\-().]{7,20}$/,
  MESSAGE: 'Invalid phone number',
};
