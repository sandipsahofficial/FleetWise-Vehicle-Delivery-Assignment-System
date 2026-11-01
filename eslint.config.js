const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  // Ignore directories
  {
    ignores: [
      'node_modules/**',
      'data/**',
      'storage/**',
      'backups/**',
      'coverage/**',
      '**/*.min.js'
    ]
  },

  // Base configuration for Node.js files (server, services, tests, scripts)
  {
    files: ['**/*.js'],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'commonjs',
      globals: {
        ...globals.node
      }
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_'
        }
      ],
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-undef': 'error'
    }
  },

  // Browser scripts under src/public (dispatcher dashboard, tracking portal, driver UI)
  {
    files: ['src/public/**/*.js'],
    ignores: ['src/public/driver/sw.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'script',
      globals: {
        ...globals.browser,
        L: 'readonly',
        io: 'readonly'
      }
    },
    rules: {
      'no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_'
        }
      ],
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-undef': 'error'
    }
  },

  // Service Worker for driver PWA
  {
    files: ['src/public/driver/sw.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'script',
      globals: {
        ...globals.serviceworker
      }
    },
    rules: {
      'no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_'
        }
      ],
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-undef': 'error'
    }
  }
];
