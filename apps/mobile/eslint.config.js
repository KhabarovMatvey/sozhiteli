const expoConfig = require('eslint-config-expo/flat');

module.exports = [
  ...expoConfig,
  { ignores: ['dist/**', '.expo/**'] },
  {
    // Версия React указана явно: автоопределение в eslint-plugin-react
    // использует API, удалённый в ESLint 10.
    settings: { react: { version: '19.2' } },
  },
  {
    rules: {
      // Backend вызывается только через типизированный клиент (README.md, раздел «API»).
      'no-restricted-globals': [
        'error',
        {
          name: 'fetch',
          message: 'Вызывайте API через useApi() из src/lib/api.ts, а не fetch напрямую.',
        },
      ],
    },
  },
  {
    // Единственное место, где разрешён прямой fetch: проверка готовности сервисов.
    files: ['src/lib/health.ts'],
    rules: { 'no-restricted-globals': 'off' },
  },
];
