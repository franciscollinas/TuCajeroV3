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
    // El servidor de CI (Windows) a veces tarda más de los 5 s / 10 s por defecto en preparar las bases
    // de prueba: un fallo por tiempo, no por el código, tumbaba la verificación de una PR sin motivo.
    testTimeout: 30000,
    hookTimeout: 60000,
    exclude: [...configDefaults.exclude, 'tests/massive-stress.test.ts', 'KeyGen/**'],
  },
});
