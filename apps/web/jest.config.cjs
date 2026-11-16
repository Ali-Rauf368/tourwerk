const path = require('node:path');

module.exports = {
  testEnvironment: 'jsdom',
  roots: ['<rootDir>/src'],
  testPathIgnorePatterns: ['/node_modules/', 'helpers.tsx'],
  setupFiles: ['<rootDir>/src/test/polyfills.ts'],
  setupFilesAfterEnv: ['<rootDir>/src/test/setup.ts'],
  moduleNameMapper: { '\\.css$': 'identity-obj-proxy' },
  // Explicit configFile so Babel also applies to hoisted ESM packages in ../../node_modules.
  transform: { '^.+\\.[tj]sx?$': ['babel-jest', { configFile: path.join(__dirname, 'babel.config.cjs') }] },
};
