# Brand and visual identity

Tropical Palawan transportation: travel, trust, safety, modern technology. Flat surfaces framed in
deep green, gold as the single accent, generous white space. Not a banking app, and not a gradient
showcase.

## Palette

Defined once in `tailwind.config.js` (class names) and mirrored in `src/constants/theme.ts` (raw
values for react-navigation, `StatusBar`, SVG and map styling). **Change both together.**

| Token | Hex | Use |
|---|---|---|
| `primary` | `#087443` | Primary actions, active states |
| `primary-dark` | `#055C35` | Pressed states, wordmark |
| `primary-deep` | `#08512B` | Gradient ends, the badge ground |
| `primary-soft` | `#E6F2EC` | Tinted fills, active-tab wash |
| `secondary` | `#F5B800` | Gold accent — highlights, "Go", fare emphasis |
| `secondary-dark` | `#C99600` | Gold text on light backgrounds (contrast) |
| `aqua` | `#1FBEB4` | Sea accent from the mark; sparingly |
| `sun` | `#FFC820` | Sun accent from the mark; sparingly |
| `background` | `#F7FAF7` | Page ground |
| `background-tint` | `#EAF4EE` | Banded sections, map placeholders |
| `surface` | `#FFFFFF` | Cards |
| `content` / `-muted` / `-inverse` | `#12352A` / `#6B7F76` / `#FFFFFF` | Text |
| `border` / `-strong` | `#E2EAE5` / `#C9D6CF` | Hairlines, input outlines |
| `success` `warning` `danger` `info` | `#16A34A` `#F59E0B` `#DC2626` `#0284C7` | Status, each with a `-soft` fill |

Gold on white fails contrast at body size — use `secondary-dark` for gold *text*, and reserve
`secondary` for fills and large display type.

## Gradients

Only two, both in `Gradients` in `src/constants/theme.ts`, and only on brand surfaces:

- `Gradients.brand` — deep green, used by `BrandHero`.
- `Gradients.sunset` — green into gold, reserved for future celebratory surfaces.

Everything else is flat. If a third gradient seems necessary, it probably isn't.

## The mark

`assets/brand/palago-icon.svg` is the single source of truth: a palm, sunset, coach and winding road
inside a deep-green circle, with the sea and islands to the right.

It exists in two forms that must be kept in step:

| Form | File | Used for |
|---|---|---|
| SVG | `assets/brand/palago-icon.svg` | Source for rasterising app icons |
| React | `src/components/common/palago-mark.tsx` | In-app rendering, via `react-native-svg` |

The in-app mark is vector rather than a bitmap so it stays sharp from a 24px header to the splash
screen and costs no image decode at first paint.

### App icons

Generated, never hand-edited:

```bash
node scripts/generate-icons.mjs
```

This writes `icon.png`, `splash-icon.png`, `favicon.png`, and the three Android adaptive layers into
`assets/images/`. The adaptive foreground insets the art to ~62% because launchers crop adaptive
icons to a circle or squircle — art drawn to the full bounds loses the palm and the coach.

> **Swapping in the original raster art.** The current mark is a vector *recreation* of the supplied
> brand illustration. To use the original instead, drop it in as
> `assets/brand/palago-icon-source.png` (square, ideally 1024px or larger, transparent background)
> and re-run the script — it prefers that file automatically. The in-app `PalaGoMark` would then be
> replaced with an `Image`, or the SVG redrawn to match.

## The lockup

`PalaGoLogo` composes the mark with the two-tone wordmark — "Pala" in `primary-dark`, "Go" in
`secondary-dark` — and optionally the tagline *Your Ride. Your Palawan. Your Way.*

```tsx
<PalaGoLogo size="lg" layout="stacked" withTagline inverse />
```

| Prop | Values |
|---|---|
| `size` | `sm` `md` `lg` `xl` |
| `layout` | `horizontal` (default), `stacked`, `mark` (badge only — tab bars, avatars) |
| `inverse` | White wordmark, for the green hero |

The wordmark is real text, not outlines: it renders in the platform font, scales with the user's
type settings, and the lockup exposes one "PalaGo" label to screen readers rather than two
fragments.

## `BrandHero`

The recurring green banner: gradient, lockup, and an optional title and subtitle. Used by login,
register, reset-password and the public payment page. It bleeds past the screen's horizontal
padding with negative margins so the colour reaches the edges while the content column stays
aligned.

## Accessibility

Carried from Phase 1 and not negotiable: 44px minimum touch targets, an `accessibilityLabel` on
every icon-only control, and status never conveyed by colour alone — `Badge` and `Alert` always
carry text.
