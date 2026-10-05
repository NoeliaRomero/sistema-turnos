import { test, expect, ADMIN, loginAs, uniqueName } from '../helpers';
import { AdminPage } from './admin-page';

test.describe('Admin - games', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, ADMIN);
  });

  test('Admin creates a game with stages, subcategories, laps and auto-call',
    { tag: ['@critical', '@e2e', '@admin', '@ADMIN-E2E-001'] },
    async ({ page, adminApi }) => {
      const adminPage = new AdminPage(page);
      const nombre = uniqueName('Karting');

      await adminPage.goto();
      await adminPage.openGamesTab();
      await adminPage.createGame({
        nombre,
        etapas: ['Charla', 'En pista'],
        subcategorias: ['Adultos', 'Menores'],
        vueltas: [5, 10],
        llamadoAutomaticoSeg: 2,
      });

      const row = adminPage.gameRow(nombre);
      await expect(row).toContainText('2 etapas');
      await expect(row).toContainText('2 subcategorías');
      await expect(row).toContainText('5 / 10 vueltas');

      const game = await adminApi.trackGameByName(nombre);
      expect(game.etapas.map(e => e.nombre)).toEqual(['Charla', 'En pista']);
      expect(game.subcategorias.map(s => s.nombre)).toEqual(['Adultos', 'Menores']);
      expect(game.vueltas.map(v => v.cantidad)).toEqual([5, 10]);
      expect(game).toMatchObject({ usa_etapas: 1, usa_subcategorias: 1, usa_vueltas: 1, llamado_automatico: 1, tiempo_entre_llamados_segundos: 2 });
    });

  test('Admin edits a lap option and the option keeps its id',
    { tag: ['@high', '@e2e', '@admin', '@ADMIN-E2E-002'] },
    async ({ page, adminApi }) => {
      const game = await adminApi.createGame({ etapas: ['Charla', 'En pista'], vueltas: [5, 10] });
      const adminPage = new AdminPage(page);

      await adminPage.goto();
      await adminPage.openGamesTab();
      await adminPage.editLapOption(game.nombre, 10, 15);

      await expect(adminPage.gameRow(game.nombre)).toContainText('5 / 15 vueltas');
      const updated = await adminApi.findGame(game.nombre);
      expect(updated.vueltas).toEqual([
        expect.objectContaining({ id: game.vueltas[0].id, cantidad: 5 }),
        expect.objectContaining({ id: game.vueltas[1].id, cantidad: 15 }),
      ]);
    });

  test('Editing a game while a group is in a stage keeps that group in its stage',
    { tag: ['@high', '@e2e', '@admin', '@ADMIN-E2E-003'] },
    async ({ page, adminApi }) => {
      const game = await adminApi.createGame({ etapas: ['Charla', 'En pista'], vueltas: [5, 10] });
      const turn = await adminApi.createTurn(game, { vueltas: 5 });
      await adminApi.call(turn);

      const adminPage = new AdminPage(page);
      await adminPage.goto();
      await adminPage.openGamesTab();
      await adminPage.editLapOption(game.nombre, 10, 15);

      expect((await adminApi.turn(turn.id, game)).etapa_actual_nombre).toBe('Charla');
      const advance = await adminApi.ctx.put(`/api/turnos/${turn.id}/finalizar`);
      expect(advance.status()).toBe(200);
      const after = await adminApi.turn(turn.id, game);
      expect(after).toMatchObject({ estado: 'jugando', etapa_actual_nombre: 'En pista' });
    });
});
