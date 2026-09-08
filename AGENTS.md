# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

# PalaGo

Transportation booking for Cherry Bus and RoRo Bus. See [README.md](README.md) for the phase plan
and [docs/](docs/) for architecture, payment, QR, realtime, security and testing.

## Non-negotiables

- **Mock payment only.** No Stripe, GCash, Maya, card or bank integration. `src/lib/env.ts` rejects
  any payment provider other than `mock`; that guard stays until a real provider is deliberately
  added. Every peso figure is test data and must be labelled as such in the UI.
- **The server is the source of truth.** The client never decides a price, a payment status, a
  booking status, a loyalty balance, or whether someone boarded. Privileged operations go through
  Edge Functions, never direct table writes.
- **Never fake success.** No hardcoded success responses, no confirming a payment in React state, no
  reporting a feature as done because a screen renders. Unfinished routes use `PlaceholderScreen`,
  which says which phase will implement them.
- **RLS is never disabled** to make frontend work easier.
- **Phases are sequential.** Do not start a phase until the previous one passes `pnpm check` and its
  browser verification.

## Conventions

- Money is integer centavos. Format with `@/utils/money`, never do currency maths in floats.
- Statuses come from `src/constants/enums.ts` — no inline status strings.
- Errors use the codes in `src/constants/errors.ts`.
- Screens compose; services own Supabase access; hooks wrap services in TanStack Query. Screens do
  not call Supabase directly.
- Zustand holds client state only. Server state lives in TanStack Query.
- Styling is NativeWind classes; `src/constants/theme.ts` holds raw values for the places that
  cannot take class names. Change both together.
- Avoid `any`. Touch targets ≥44px. Icon-only buttons require an `accessibilityLabel`. Status is
  never conveyed by colour alone.
- Every feature screen handles loading, empty, error and offline — use `src/components/ui/states.tsx`.

## Gotchas already paid for

- **The root layout must stay light.** No auth gate and no native permission providers in
  `src/app/_layout.tsx` — the public `/payment/[reference]` page renders in that same tree in a
  logged-out browser. Gate inside `(user)` / `(operator)` instead.
- **`app.json` keeps `web.output: "single"`**, or deep-linked payment references 404.
- **pnpm + Metro**: `.npmrc` public-hoists `react-native-css-interop`. Removing it breaks the bundle
  with "Unable to resolve react-native-css-interop/jsx-runtime".
- **ESLint must stay on v9.** v10 breaks `eslint-plugin-react` as bundled by `eslint-config-expo`.
- **RNTL v14**: `render` is async (`await render(...)`) and interactions use `userEvent`.
- **Typed routes**: dynamic hrefs need the object form,
  `{ pathname: '/payment/[reference]', params: { reference } }`.
- **`nativewind-env.d.ts` is committed** — it is hand-written, and `tsc` fails without it.
- **Route groups do not appear in the URL.** `(user)/profile.tsx` and `(operator)/profile.tsx` both
  resolve to `/profile` and collide silently — the route falls through to somewhere else entirely.
  Give same-named screens in different groups distinct filenames (the operator one is `account.tsx`).
- **`/reset-password` lives at the router root, not in `(auth)`.** The recovery link creates a real
  session, so an `(auth)` layout would redirect the user away from the form they came to use.
- **`src/types/database.ts` is generated.** Run `pnpm db:types` after a migration; never hand-edit.
- **`trip_seats` has no client write policy, deliberately.** Seat state changes only inside
  SECURITY DEFINER functions that can lock rows. A client able to UPDATE it could double-book.
- **Run `pnpm db:verify` after any migration touching a policy** — 31 RLS checks against real
  signed-in roles. Unit tests cannot cover RLS.
- **Do not set `"jsx"` in tsconfig.json.** `expo/tsconfig.base` sets `react-jsx`; overriding it with
  `react` breaks every `.tsx` file with "React refers to a UMD global".
- **Seeding auth.users directly** needs `confirmation_token`/`recovery_token`/
  `email_change_token_new`/`email_change` set to `''` and a matching `auth.identities` row, or
  sign-in fails with the misleading "Database error querying schema". See docs/database.md.
- Guards (`AuthGate`) are navigation only. Data access is enforced by RLS — see docs/auth.md.
- **MapLibre is native-only.** No Expo Go, no react-native-web. Keep the `map.tsx` / `map.web.tsx`
  split — importing MapLibre into the web bundle breaks the public payment page. See docs/realtime.md.
- **react-native-svg: use `transform="translate(x y)"`, not `translateX`/`translateY` props.** Those
  are native-only and leak to the DOM on web as unknown React attributes.
- **App icons are generated** from `assets/brand/palago-icon.svg` by `node scripts/generate-icons.mjs`.
  Never hand-edit the PNGs in `assets/images/`. Palette and logo rules: docs/brand.md.

## Commands

```bash
pnpm check
```

`typecheck` · `lint` · `test` · `web` · `android` · `db:start` · `db:reset` · `db:types`

The web dev server runs on port 8090 (8081 is taken on this machine).
