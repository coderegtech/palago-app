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
};
