# Authentication and roles

Supabase Auth with email and password. Sessions are persisted by supabase-js —
`AsyncStorage` on native, `localStorage` on web — and mirrored into a Zustand store so route
guards can read them during render.

## Identity model

`auth.users` (Supabase-owned) ←1:1→ `public.profiles` (ours).

The profile is created **by a database trigger**, not by the app:

```
sign-up → auth.users insert → on_auth_user_created → handle_new_user() → profiles row
```

Doing it in the database means a registration cannot half-succeed into an auth user with no
profile — a failure mode that is otherwise very easy to hit when the client crashes between two
network calls.

## Roles

`USER`, `OPERATOR`, `DRIVER`, `ASSISTANT`, `ADMIN` — a Postgres enum mirroring `UserRole` in
`src/constants/enums.ts`. Change both together.

**A role can never be set by the account holder.** Three independent defences:

1. `handle_new_user()` hard-codes `'USER'` and ignores any `role` in `raw_user_meta_data`. That
   metadata is supplied by whoever calls sign-up, so trusting it would let anyone register as
   `ADMIN`.
2. Column-level grants: `authenticated` may update `full_name`, `phone`, `avatar_url` and the two
   emergency-contact columns — and nothing else. `role` is not grantable, so Postgres rejects the
   write regardless of what any RLS policy says.
3. `profileSchema` has no `role` field, so the client cannot even express the update.

Roles are assigned administratively with the service role. Phase 7 adds an admin path for this;
for now:

```bash
docker exec supabase_db_palago-app psql -U postgres -d postgres -c "update public.profiles set role='OPERATOR' where email='someone@example.com';"
```

## RLS on `profiles`

| Operation | Policy |
|---|---|
| SELECT | own row, or any row if `is_admin()` |
| UPDATE | own row (columns restricted by grant), or any row if `is_admin()` |
| INSERT | none — the trigger creates it |
| DELETE | none — cascades from `auth.users` |

`is_admin()` and `current_profile_role()` are `SECURITY DEFINER`, which is what stops a policy that
reads `profiles.role` from recursing into itself.

Verified behaviour (probed against the live local stack): a signed-in user sees exactly one row
(their own), cannot read or edit another user's row, cannot insert, cannot change their own role,
and an anonymous client sees nothing.

## Route guards

`AuthGate` (`src/components/common/auth-gate.tsx`) wraps the `(user)`, `(operator)`, `booking` and
`bookings` layouts. It waits for `initialized` before deciding — deciding earlier bounces a
signed-in user to the login screen on every cold start — then redirects to `(auth)/login` when
signed out, or to the role's home when the role is not allowed for that group.

**Guards are navigation, not authorisation.** They stop someone wandering into the wrong tab. They
do not protect data; RLS does. Never rely on a guard to keep a row private.

`(auth)` inverts the check: a signed-in user is sent to their role's home rather than shown a login
form.

## Public routes

Two routes deliberately sit outside every gate, at the root of the router:

- `/payment/[reference]` — opened by scanning a QR from a different phone, with no PalaGo session.
- `/reset-password` — the target of the recovery email. It is **not** inside `(auth)`, because the
  recovery token creates a real session and the `(auth)` layout would immediately redirect the user
  away from the form they arrived to use.

This is why the root layout carries no auth gate. See [architecture.md](architecture.md).

## Password reset

```
Forgot password → resetPasswordForEmail(email, redirectTo)
  → email with /auth/v1/verify?token=…&type=recovery&redirect_to=…/reset-password
  → app opens with the token in the URL fragment
  → detectSessionInUrl turns it into a recovery session
  → updateUser({ password })
```

`redirectTo` must be listed in `auth.additional_redirect_urls` in `supabase/config.toml`, and
`site_url` must point at the app. Locally, sent mail is captured by Mailpit at
<http://127.0.0.1:54324>.

The success message is worded identically whether or not the address has an account. Confirming
that an email is registered would turn the form into an account-enumeration oracle — the same
reason `signIn` keeps Supabase's vague "Invalid login credentials".

## Password policy

`PASSWORD_MIN_LENGTH` (8) in `src/schemas/auth.ts` matches `auth.minimum_password_length` in
`supabase/config.toml`. If they diverge the server wins and the user sees a confusing error.

Login deliberately does *not* length-check the password: an existing account may predate a policy
change, and rejecting a correct password client-side would lock someone out of their own account.

## Local development

`enable_confirmations = false` locally, so sign-up returns a session immediately. In production it
should be enabled — `authService.signUp` returns `null` in that case and the register screen shows
a "check your email" state, so both paths are already handled.
