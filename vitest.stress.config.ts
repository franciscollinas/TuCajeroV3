import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Suite de estrés: `npm run test:stress`. Genera tests/STRESS_REPORT.md.
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/massive-stress.test.ts'],
    testTimeout: 0,
  },
});
