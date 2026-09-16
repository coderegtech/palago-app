/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  moduleNameMapper: {
    // Metro compiles the NativeWind stylesheet; Jest cannot parse it.
    '\\.css$': '<rootDir>/jest.css-stub.js',
    // lucide's "react-native" entry — which jest-expo resolves first — is an
    // .mjs file, and babel-jest only transforms .js/.ts. Its "main" build is
    // the same icons as CommonJS. Tests only; the app bundle is unaffected.
    '^lucide-react-native$':
      '<rootDir>/node_modules/lucide-react-native/dist/cjs/lucide-react-native.js',
    '^@/assets/(.*)$': '<rootDir>/assets/$1',
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  collectCoverageFrom: ['src/**/*.{ts,tsx}', '!src/**/*.d.ts'],
  // A ratchet, not a target.
  //
  // Thresholds are set only where coverage is real, a few points below where it
  // stands, so the build fails if one of these layers regresses. There is
  // deliberately no global number: most of `src/` is screens, which are
  // verified in a browser and by the walkthrough capture rather than by Jest,
  // and a global threshold low enough to pass would guarantee nothing while
  // looking like it did.
  //
  // What is NOT here is as deliberate. `services/` and `hooks/` sit in single
  // digits; their real guarantees — RLS, concurrency, idempotency — are proven
  // by the sixteen verify suites against a live database, which no unit test
  // can reach. Adding a number here would suggest otherwise. See docs/testing.md.
  //
  // Directory keys, not globs: Jest applies a glob threshold to every matching
  // file individually, which would demand 60% of `lib/observe.ts` and
  // `lib/query-client.ts` — two config modules with no behaviour to cover. A
  // directory key aggregates, which is the question worth asking.
  coverageThreshold: {
    'src/utils/': { statements: 90, branches: 85 },
    'src/schemas/': { statements: 95, branches: 90 },
    'src/lib/': { statements: 60, branches: 50 },
    'src/constants/': { statements: 90, branches: 80 },
  },
};
