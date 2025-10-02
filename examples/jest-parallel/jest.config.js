export default {
  testEnvironment: 'node',
  maxWorkers: 5,
  testMatch: ['**/tests/**/*.test.js'],
  globalSetup: './setup.js',
  globalTeardown: './teardown.js',
  transform: {}
}
