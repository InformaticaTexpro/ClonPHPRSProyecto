/** @type {import('jest').Config} */
module.exports = {
  rootDir: '.',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  testMatch: ['**/*.test.js'],
  moduleFileExtensions: ['js', 'json'],
  collectCoverage: false,
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov'],
  testPathIgnorePatterns: [
    '/node_modules/',
    '/coverage/',
    // Tests de integración — requieren BD real, excluidos de npm test y CI
    // Ejecutar manualmente: npm run test:mysql | npm run test:softland
    'src/config/db.test.js',
    'src/config/db.softland.test.js'
  ],
  modulePathIgnorePatterns: ['<rootDir>/dist/'],
  clearMocks: true,
  verbose: true,
  forceExit: true
};
