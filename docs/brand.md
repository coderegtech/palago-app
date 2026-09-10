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

`assets/images/icon.png` — the original brand illustration on a transparent ground: a palm, sunset,
coach and winding road, with the sea and islands to the right — is the source of truth for the mark.

| Form | File | Used for |
|---|---|---|
| Raster (source of truth) | `assets/brand/palago-icon-source.png` | What `generate-icons.mjs` actually rasterises from. Edit this to change the mark everywhere. |
| Raster (generated) | `assets/images/icon.png` | In-app rendering (`PalaGoMark`, via `expo-image`) and the app icon. Generated — do not hand-edit. |
| SVG | `assets/brand/palago-icon.svg` | A traced vector recreation, kept as the fallback `generate-icons.mjs` uses only when the raster source is absent |

`PalaGoMark` renders `icon.png` directly through an `expo-image` `Image` rather than redrawing the
artwork as SVG paths, so the in-app mark is pixel-identical to the shipped app icon and splash
screen.

### App icons

`icon.png`, `splash-icon.png`, `favicon.png`, and the three Android adaptive layers in
`assets/images/` all come from one source, so the icon and the splash cannot drift apart. To change
the mark, replace `assets/brand/palago-icon-source.png` (square, ideally 1024px or larger,
transparent background) and run:

```bash
node scripts/generate-icons.mjs
```

The adaptive foreground insets the art to ~62% because launchers crop adaptive icons to a circle or
squircle — art drawn to the full bounds loses the palm and the coach. Never hand-edit the generated
PNGs.

`assets/images/palago.png` is the full horizontal lockup (mark, wordmark and tagline baked into one
flattened image on an opaque white ground). It isn't used in-app — `PalaGoLogo` composes the mark
with a real-text wordmark instead so it can render inverse on `BrandHero`'s green gradient, which a
white-background flattened image can't do. Reach for `palago.png` outside the app shell: store
listings, the README, marketing pages.

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

### Two rules the generator encodes

- **The Android adaptive foreground is inset to ~62%.** Launchers crop adaptive icons to a circle or
  squircle and parallax the layers, so art drawn to the edge loses the palm and the front of the
  bus. `adaptiveForeground()` insets it into the safe zone.
- **The adaptive *background* must stay a flat colour.** Android moves the two layers independently;
  detail there slides around behind the foreground. It is `primary-soft` `#E6F2EC`.

### The splash background has to stay light

The mark is drawn for a light ground: the palm fronds, the road and the drop shadow are all dark
green. On `primary` `#087443` they merge into the background and the logo reads as a floating bus
and sun with its left half missing. The splash `backgroundColor` in `app.json` therefore needs to be
a light value — `primary-soft` `#E6F2EC` matches the Android adaptive background, so the two read as
the same brand.

Changing it back to a dark colour means commissioning a light-knockout version of the mark, not just
editing the hex.
