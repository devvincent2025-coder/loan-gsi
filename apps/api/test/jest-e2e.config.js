module.exports = {
  rootDir: '..',
  testRegex: 'test/.*\\.e2e-spec\\.ts$',
  transform: { '^.+\\.ts$': ['ts-jest', { diagnostics: false, isolatedModules: true }] },
  testEnvironment: 'node',
  testTimeout: 90000,
  setupFiles: ['<rootDir>/test/e2e-env.ts'],
};
