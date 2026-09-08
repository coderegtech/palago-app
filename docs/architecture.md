# Architecture

## Shape of the system

PalaGo is one Expo application serving three audiences, plus a Supabase backend that owns all
authoritative state.

```
┌──────────────────────────────────────────────┐
│ Expo app (React Native + react-native-web)   │
│                                              │
│  (auth)      login / register / reset        │
│  (user)      passenger app                   │
│  (operator)  operator app                    │
│  booking     the booking funnel              │
│  payment/[reference]   public test-payment   │  ← rendered by the web build
└───────────────┬──────────────────────────────┘
                │ publishable key only, bounded by RLS
                ▼
┌──────────────────────────────────────────────┐
│ Supabase                                     │
│  Postgres + RLS      authoritative state     │
│  Auth                sessions and roles      │
│  Realtime            payment/booking/GPS     │
│  Edge Functions      every privileged action │
│  Storage             avatars, operator logos │
└──────────────────────────────────────────────┘
```

## Why the payment page lives in the app

The test-payment page is an Expo Router route rather than a separate Next.js project. It is opened
by scanning a QR from a *different* phone, in a browser with no PalaGo session, so two constraints
follow and must be preserved as the app grows:

1. **`src/app/_layout.tsx` stays light.** No auth gate, no camera/location/notification providers at
   the root. Anything requiring a session or a native permission belongs to a group layout
   (`(user)`, `(operator)`) instead.
2. **`app.json` keeps `web.output: "single"`.** A static export would 404 on an arbitrary
   `/payment/PAY-2026-000123`; the SPA fallback resolves it client-side.

## Layers

| Layer | Location | Rule |
|---|---|---|
| Screens | `src/app/**` | Composition and local UI state only. No Supabase calls. |
| Feature components | `src/components/<feature>/` | Presentational; data arrives as props. |
| UI primitives | `src/components/ui/` | Design system. No domain knowledge. |
| Hooks | `src/hooks/` | TanStack Query wrappers over services. |
| Services | `src/services/` | All Supabase queries, mutations, and Edge Function calls. |
| Stores | `src/stores/` | Zustand, **client state only**. |
| Types / constants | `src/types/`, `src/constants/` | Shared vocabulary, mirrored by the database. |

Server state belongs in TanStack Query; Zustand holds only what the client itself owns (session
mirror, toasts, in-progress booking selections). Copying database rows into Zustand produces two
sources of truth and is not done.

## State ownership

The database is the source of truth for anything that matters. The client never decides:

- what a booking costs,
- whether a payment is paid,
- whether a booking is confirmed,
- how many loyalty points someone has,
- whether a passenger has boarded.

Each of those is computed and verified server-side. See [security.md](security.md).

## Design system

Tokens are declared twice on purpose and must be changed together:

- `tailwind.config.js` — the class-name vocabulary (`bg-primary`, `text-content-muted`, `rounded-card`).
- `src/constants/theme.ts` — raw values for the places that cannot take class names: react-navigation
  themes, `StatusBar`, SVG props, and map styling.

Accessibility rules that hold from Phase 1:

- Minimum 44px touch targets (`MIN_TOUCH_TARGET`, enforced in `Button` and `IconButton`).
- Icon-only controls require an `accessibilityLabel` — it is a required prop on `IconButton`.
- Status is never conveyed by colour alone; `Badge` and `Alert` always carry text.

## Screen states

Every feature screen must handle loading, empty, error, and offline. The shared implementations live
in `src/components/ui/states.tsx` (`Loading`, `EmptyState`, `ErrorState`, `OfflineState`, `Skeleton`)
so screens do not each invent their own.

## Build configuration notes

- **pnpm + Metro.** `.npmrc` public-hoists `react-native-css-interop`. NativeWind's Babel transform
  rewrites JSX in our own source files to import it, and Metro does not follow pnpm's nested symlink
  layout — without the hoist the bundle fails to resolve.
- **React Compiler** is enabled (`experiments.reactCompiler`) and coexists with `nativewind/babel`.
- **`nativewind-env.d.ts` is committed**, unlike the generated `expo-env.d.ts`. It is hand-written,
  and a fresh clone fails `tsc` without it.
