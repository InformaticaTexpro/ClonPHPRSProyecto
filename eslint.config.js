const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  {
    ignores: ['node_modules/**', 'coverage/**', 'dist/**']
  },
  js.configs.recommended,
  {
    // languageOptions sin restricción de files — garantiza ecmaVersion 2022 en todos los archivos
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
        ...globals.browser,
        ...globals.jest,
        Chart: 'readonly'
      }
    }
  },
  {
    files: ['**/*.js'],
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-console': 'off'
    }
  }
];
