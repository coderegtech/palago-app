import {
  forgotPasswordSchema,
  loginSchema,
  profileSchema,
  registerSchema,
  updatePasswordSchema,
} from '@/schemas/auth';

const validRegistration = {
  fullName: 'Juan Dela Cruz',
  email: 'juan@example.com',
  phone: '0917 123 4567',
  password: 'CorrectHorse8',
  confirmPassword: 'CorrectHorse8',
};

describe('loginSchema', () => {
  it('accepts a valid login', () => {
    const result = loginSchema.parse({ email: 'a@b.com', password: 'anything' });
    expect(result).toEqual({ email: 'a@b.com', password: 'anything' });
  });

  it('normalises the email to lowercase and trims it', () => {
    const result = loginSchema.parse({ email: '  Juan@Example.COM ', password: 'x' });
    expect(result.email).toBe('juan@example.com');
  });

  it('rejects a malformed email', () => {
    expect(loginSchema.safeParse({ email: 'nope', password: 'x' }).success).toBe(false);
  });

  it('does not length-check the password', () => {
    // An account may predate a policy change; rejecting a correct password
    // client-side would lock the user out of their own account.
    expect(loginSchema.safeParse({ email: 'a@b.com', password: 'short' }).success).toBe(true);
  });
});

describe('registerSchema', () => {
  it('accepts a valid registration', () => {
    expect(registerSchema.safeParse(validRegistration).success).toBe(true);
  });

  it.each([
    ['+639171234567'],
    ['09171234567'],
    ['9171234567'],
    ['+63 917 123 4567'],
    ['0917-123-4567'],
  ])('accepts the Philippine mobile format %s', (phone) => {
    expect(registerSchema.safeParse({ ...validRegistration, phone }).success).toBe(true);
  });

  it.each([['12345'], ['0817 123 4567'], ['+1 555 123 4567'], ['091712345678']])(
    'rejects %s as a Philippine mobile number',
    (phone) => {
      expect(registerSchema.safeParse({ ...validRegistration, phone }).success).toBe(false);
    },
  );

  it('rejects a password under the minimum length', () => {
    const result = registerSchema.safeParse({
      ...validRegistration,
      password: 'Short1',
      confirmPassword: 'Short1',
    });
    expect(result.success).toBe(false);
  });

  it('reports mismatched passwords against the confirm field', () => {
    const result = registerSchema.safeParse({
      ...validRegistration,
      confirmPassword: 'SomethingElse9',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(['confirmPassword']);
      expect(result.error.issues[0].message).toMatch(/do not match/i);
    }
  });

  it('rejects a one-character name', () => {
    expect(registerSchema.safeParse({ ...validRegistration, fullName: 'J' }).success).toBe(false);
  });
});

describe('forgotPasswordSchema', () => {
  it('requires an email', () => {
    expect(forgotPasswordSchema.safeParse({ email: '' }).success).toBe(false);
    expect(forgotPasswordSchema.safeParse({ email: 'a@b.com' }).success).toBe(true);
  });
});

describe('updatePasswordSchema', () => {
  it('requires both passwords to match', () => {
    expect(
      updatePasswordSchema.safeParse({ password: 'LongEnough1', confirmPassword: 'LongEnough1' })
        .success,
    ).toBe(true);
    expect(
      updatePasswordSchema.safeParse({ password: 'LongEnough1', confirmPassword: 'Different1' })
        .success,
    ).toBe(false);
  });
});

describe('profileSchema', () => {
  const valid = {
    fullName: 'Juan Dela Cruz',
    phone: '09171234567',
    emergencyContactName: '',
    emergencyContactPhone: '',
  };

  it('accepts empty emergency contact fields', () => {
    expect(profileSchema.safeParse(valid).success).toBe(true);
  });

  it('validates an emergency contact number when one is given', () => {
    expect(
      profileSchema.safeParse({ ...valid, emergencyContactPhone: '0917 765 4321' }).success,
    ).toBe(true);
    expect(profileSchema.safeParse({ ...valid, emergencyContactPhone: '12345' }).success).toBe(
      false,
    );
  });

  it('has no role field, so a role can never be submitted', () => {
    // The database also revokes the column grant; this asserts the client half.
    const parsed = profileSchema.parse({ ...valid, role: 'ADMIN' } as never);
    expect(parsed).not.toHaveProperty('role');
  });
});
