export default [
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        console: 'readonly',
        process: 'readonly',
        setTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        clearTimeout: 'readonly',
        Buffer: 'readonly'
      }
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': 'off',
      semi: ['error', 'never'],
      quotes: ['error', 'single', { avoidEscape: true }],
      indent: ['error', 2],
      'comma-dangle': ['error', 'never'],
      'no-trailing-spaces': 'error',
      'eol-last': ['error', 'always']
    }
  }
]
