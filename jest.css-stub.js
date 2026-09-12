/**
 * Stands in for CSS imports under Jest.
 *
 * `src/constants/theme.ts` imports `@/global.css` so NativeWind's styles load
 * with the tokens, and Metro handles that. Jest's transform does not, so any
 * test that reaches the theme (anything using `Colors`) would fail parsing
 * `@tailwind base`. Styling is not asserted in these tests.
 */
module.exports = {};
