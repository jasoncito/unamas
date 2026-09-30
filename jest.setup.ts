// jest-expo stubs expo-crypto with functions that return undefined; ids need real UUIDs.
jest.mock('expo-crypto', () => ({
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  randomUUID: () => require('node:crypto').randomUUID(),
}));
