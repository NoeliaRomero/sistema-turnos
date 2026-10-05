import { test, expect, uniqueName } from '../helpers';
import { PantallaPage } from './pantalla-page';

test.describe('Pantalla pública (TV)', () => {
  test('The public screen shows a called group without being logged in',
    { tag: ['@critical', '@e2e', '@pantalla', '@TV-E2E-001'] },
    async ({ openSession, adminApi }) => {
      const game = await adminApi.createGame({ etapas: ['Charla', 'En pista'] });
      const turn = await adminApi.createTurn(game, { nombre: uniqueName('Familia TV') });

      // Anonymous session: no cookies at all.
      const tvPage = await openSession();
      const me = await tvPage.request.get('/api/auth/me');
      expect(me.status()).toBe(401);

      const pantalla = new PantallaPage(tvPage);
      await pantalla.goto();
      await expect(pantalla.queuedGroup(game.nombre, turn.nombre_cliente!)).toBeVisible();

      // Called while the screen is open: it updates in real time via socket.io.
      await adminApi.call(turn);

      const active = pantalla.activeGroup(game.nombre, turn.nombre_cliente!);
      await expect(active).toContainText('Llamado');
      await expect(active).toContainText(turn.biper_numero);
      await expect(active).toContainText('Charla');
      await expect(pantalla.queuedGroup(game.nombre, turn.nombre_cliente!)).toHaveCount(0);
    });
});
