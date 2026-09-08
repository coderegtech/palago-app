/**
 * Auth form validation.
 *
 * These are UX guard rails, not security. Supabase enforces its own password
 * policy server-side (`minimum_password_length` in supabase/config.toml, set to
 * 8 to match `PASSWORD_MIN_LENGTH` here) — if the two ever disagree, the server
 * wins and the user sees a confusing error, so change them together.
 */

import { z } from 'zod';

export const PASSWORD_MIN_LENGTH = 8;

const email = z
  .string()
  .trim()
  .min(1, { error: 'Email is required' })
  .pipe(z.email({ error: 'Enter a valid email address' }))
  .transform((value) => value.toLowerCase());

const password = z
  .string()
  .min(PASSWORD_MIN_LENGTH, {
    error: `Password must be at least ${PASSWORD_MIN_LENGTH} characters`,
  })
  .max(72, { error: 'Password must be 72 characters or fewer' });

/**
 * Philippine mobile numbers, accepting the three forms people actually type:
 * +639171234567, 09171234567, 9171234567 — spaces and dashes allowed.
 */
const phone = z
  .string()
  .trim()
  .min(1, { error: 'Phone number is required' })
  .refine((value) => /^(\+?63|0)?9\d{9}$/.test(value.replace(/[\s-]/g, '')), {
    error: 'Enter a valid Philippine mobile number',
  });

export const loginSchema = z.object({
  email,
  // Not length-checked: an existing account may predate a policy change, and
  // rejecting a correct password client-side would lock the user out.
  password: z.string().min(1, { error: 'Password is required' }),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const registerSchema = z
  .object({
    fullName: z
      .string()
      .trim()
      .min(2, { error: 'Enter your full name' })
      .max(100, { error: 'Name must be 100 characters or fewer' }),
    email,
    phone,
    password,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    error: 'Passwords do not match',
    path: ['confirmPassword'],
  });
export type RegisterInput = z.infer<typeof registerSchema>;

export const forgotPasswordSchema = z.object({ email });
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const updatePasswordSchema = z
  .object({
    password,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    error: 'Passwords do not match',
    path: ['confirmPassword'],
  });
export type UpdatePasswordInput = z.infer<typeof updatePasswordSchema>;

/**
 * Editable profile fields. `role` is absent on purpose — it is not writable by
 * the account holder, and the database revokes the column grant that would let
 * them try.
 */
export const profileSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(2, { error: 'Enter your full name' })
    .max(100, { error: 'Name must be 100 characters or fewer' }),
  phone,
  emergencyContactName: z
    .string()
    .trim()
    .max(100, { error: 'Name must be 100 characters or fewer' })
    .optional()
    .or(z.literal('')),
  emergencyContactPhone: z
    .string()
    .trim()
    .optional()
    .or(z.literal(''))
    .refine(
      (value) => !value || /^(\+?63|0)?9\d{9}$/.test(value.replace(/[\s-]/g, '')),
      { error: 'Enter a valid Philippine mobile number' },
    ),
});
export type ProfileInput = z.infer<typeof profileSchema>;
