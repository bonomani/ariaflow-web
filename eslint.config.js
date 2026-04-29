import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'src/ariaflow_dashboard/static/dist/**',
      'src/ariaflow_dashboard/static/ts/app.ts',
      'node_modules/**',
    ],
  },
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        window: 'readonly',
        document: 'readonly',
        URL: 'readonly',
        Date: 'readonly',
        Math: 'readonly',
        Number: 'readonly',
        String: 'readonly',
        isNaN: 'readonly',
        console: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
);
