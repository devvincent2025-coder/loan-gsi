module.exports = {
  rootDir: '.',
  testRegex: 'src/.*\\.spec\\.ts$',
  transform: { '^.+\\.ts$': ['ts-jest', { diagnostics: false, isolatedModules: true }] },
  testEnvironment: 'node',
};
