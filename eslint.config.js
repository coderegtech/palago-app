// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', '.expo/*', 'node_modules/*', 'supabase/.temp/*'],
  },
  {
    // Enums are declared as a `const` object plus a same-named union type. That
    // is a deliberate TypeScript idiom — the two live in different declaration
    // spaces and let `BookingStatus` work as both a value and a type — but
    // no-redeclare only sees the repeated identifier.
    files: ['src/constants/**/*.ts'],
    rules: { '@typescript-eslint/no-redeclare': 'off' },
  },
]);
