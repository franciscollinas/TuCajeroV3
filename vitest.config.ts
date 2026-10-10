import { configDefaults, defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// La suite de estrés (50k iteraciones, ~30 min) no corre con `npm test`;
// se ejecuta aparte con `npm run test:stress`.
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    exclude: [...configDefaults.exclude, 'tests/massive-stress.test.ts', 'KeyGen/**'],
  },
});
