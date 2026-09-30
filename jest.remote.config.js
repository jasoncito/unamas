// Tests that talk to the real Supabase project (*.remote.ts). Plain Node environment: jest-expo
// replaces fetch with a mock, which is right for unit tests but not for these.
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/src/**/*.remote.ts'],
  transform: { '^.+\\.[jt]sx?$': ['babel-jest', { presets: ['babel-preset-expo'] }] },
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
  setupFiles: ['<rootDir>/jest.setup.ts'],
  // babel-preset-expo turns process.env.EXPO_PUBLIC_* into an import of this ESM module.
  transformIgnorePatterns: ['/node_modules/(?!expo/virtual/)'],
};
