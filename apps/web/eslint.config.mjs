import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

const config = [
  { ignores: ['.next/**', 'next-env.d.ts'] },
  ...nextVitals,
  ...nextTypescript,
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
      // CSP запрещает инлайновые стили (src/proxy.ts): атрибут style из
      // серверной разметки браузер не применит. Только классы из globals.css.
      'react/forbid-dom-props': [
        'error',
        {
          forbid: [{ propName: 'style', message: 'Используйте класс из globals.css: CSP запрещает style.' }],
        },
      ],
    },
  },
];

export default config;
