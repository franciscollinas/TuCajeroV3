import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

import { appRouter } from '../app/main/router/index';

describe('versión de la aplicación', () => {
  it('health.check informa la versión de package.json y no un número escrito a mano', async () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
    const result = await appRouter.createCaller({ user: null }).health.check();
    expect(result.version).toBe(pkg.version);
  });

  it('el flujo de publicación exige que la etiqueta coincida con la versión y no tiene disparo manual', () => {
    const workflow = readFileSync('.github/workflows/release.yml', 'utf8');
    expect(workflow).not.toMatch(/workflow_dispatch/);
    expect(workflow).toMatch(/concurrency:/);
    expect(workflow).toMatch(/GITHUB_REF_NAME/);
    expect(workflow).toMatch(/gh release create/);
  });
});
