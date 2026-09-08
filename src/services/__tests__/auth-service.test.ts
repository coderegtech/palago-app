import { AuthError } from '@supabase/supabase-js';

import { ErrorCode } from '@/constants/errors';
import { AppError } from '@/lib/errors';
import { authService } from '@/services/auth-service';
import { supabase } from '@/lib/supabase';

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn(),
      signUp: jest.fn(),
      signInWithPassword: jest.fn(),
      signOut: jest.fn(),
      resetPasswordForEmail: jest.fn(),
      updateUser: jest.fn(),
    },
    from: jest.fn(),
  },
}));

const auth = supabase.auth as unknown as Record<string, jest.Mock>;
const from = supabase.from as unknown as jest.Mock;

beforeEach(() => jest.clearAllMocks());

describe('signUp', () => {
  it('sends full name and phone as user metadata', async () => {
    auth.signUp.mockResolvedValue({ data: { session: { access_token: 't' } }, error: null });

    await authService.signUp({
      fullName: 'Juan Dela Cruz',
      email: 'juan@example.com',
      phone: '09171234567',
      password: 'CorrectHorse8',
    });

    expect(auth.signUp).toHaveBeenCalledWith({
      email: 'juan@example.com',
      password: 'CorrectHorse8',
      options: { data: { full_name: 'Juan Dela Cruz', phone: '09171234567' } },
    });
  });

  it('never sends a role', async () => {
    // Sign-up metadata is attacker-controlled. The database trigger ignores any
    // role it finds there; this asserts the client does not even offer one.
    auth.signUp.mockResolvedValue({ data: { session: null }, error: null });

    await authService.signUp({
      fullName: 'Mallory',
      email: 'mallory@example.com',
      phone: '09171234567',
      password: 'CorrectHorse8',
    });

    const metadata = auth.signUp.mock.calls[0][0].options.data;
    expect(metadata).not.toHaveProperty('role');
  });

  it('returns null when email confirmation is required', async () => {
    auth.signUp.mockResolvedValue({ data: { session: null }, error: null });

    const session = await authService.signUp({
      fullName: 'Juan',
      email: 'juan@example.com',
      phone: '09171234567',
      password: 'CorrectHorse8',
    });

    expect(session).toBeNull();
  });
});

describe('signIn', () => {
  it('returns the session', async () => {
    const session = { access_token: 'token' };
    auth.signInWithPassword.mockResolvedValue({ data: { session }, error: null });

    await expect(authService.signIn('a@b.com', 'pw')).resolves.toBe(session);
  });

  it('raises an AppError on bad credentials', async () => {
    auth.signInWithPassword.mockResolvedValue({
      data: { session: null },
      error: new AuthError('Invalid login credentials', 400),
    });

    await expect(authService.signIn('a@b.com', 'wrong')).rejects.toBeInstanceOf(AppError);
  });

  it('raises rather than returning a null session', async () => {
    auth.signInWithPassword.mockResolvedValue({ data: { session: null }, error: null });

    await expect(authService.signIn('a@b.com', 'pw')).rejects.toMatchObject({
      code: ErrorCode.UNAUTHORIZED,
    });
  });
});

describe('updateProfile', () => {
  it('writes only the user-editable columns', async () => {
    const update = jest.fn().mockReturnThis();
    const eq = jest.fn().mockReturnThis();
    const select = jest.fn().mockReturnThis();
    const single = jest.fn().mockResolvedValue({
      data: {
        id: 'u1',
        full_name: 'Juan Dela Cruz',
        email: 'juan@example.com',
        phone: '09171234567',
        avatar_url: null,
        role: 'USER',
        emergency_contact_name: null,
        emergency_contact_phone: null,
        created_at: '2026-09-08T00:00:00Z',
        updated_at: '2026-09-08T00:00:00Z',
      },
      error: null,
    });
    from.mockReturnValue({ update, eq, select, single });

    const profile = await authService.updateProfile('u1', {
      fullName: 'Juan Dela Cruz',
      phone: '09171234567',
      emergencyContactName: '',
      emergencyContactPhone: '',
    });

    // `role` and `email` must not appear: the database revokes those grants, so
    // including them would fail the whole update.
    const written = update.mock.calls[0][0];
    expect(Object.keys(written).sort()).toEqual([
      'emergency_contact_name',
      'emergency_contact_phone',
      'full_name',
      'phone',
    ]);

    // Blank optional fields become NULL rather than empty strings.
    expect(written.emergency_contact_name).toBeNull();
    expect(profile.role).toBe('USER');
    expect(profile.fullName).toBe('Juan Dela Cruz');
  });
});
