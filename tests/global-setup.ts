import { request, type FullConfig } from '@playwright/test';

/**
 * Runs after the webServer is up (Playwright starts plugins first).
 * Fails fast with a clear message if the isolated license is not active,
 * instead of letting every test fail with a 403 "Sistema no activado".
 */
export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0].use.baseURL as string;
  const ctx = await request.newContext({ baseURL });
  try {
    const login = await ctx.post('/api/auth/login', { data: { username: 'superadmin', password: 'super123' } });
    if (!login.ok()) throw new Error(`Superadmin login failed (${login.status()}): is the DB fresh?`);

    const info = await ctx.get('/api/licencia/info');
    const body = await info.json();
    if (body.estado !== 'activa') {
      throw new Error(`Test license is not active: ${body.razon ?? JSON.stringify(body)}`);
    }
  } finally {
    await ctx.dispose();
  }
}
