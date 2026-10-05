import { test, expect, loginAs, uniqueName, expectNoXss, XSS_NAME, type ApiClient, type Game } from '../helpers';
import { RecepcionPage } from './recepcion-page';
import { iconName } from '../base-page';

// Every reception test uses its own Karting-like game: stages, one subcategory
// and laps (5/10), no auto-call (so nothing gets called behind the test's back).
async function setup(adminApi: ApiClient, page: import('@playwright/test').Page): Promise<{ game: Game; recepcion: RecepcionPage }> {
  const game = await adminApi.createGame({ etapas: ['Charla', 'En pista'], subcategorias: ['Adultos'], vueltas: [5, 10] });
  const user = await adminApi.createUser({ rol: 'recepcion' });
  await loginAs(page, user);
  const recepcion = new RecepcionPage(page);
  await recepcion.goto();
  return { game, recepcion };
}

test.describe('Recepción - register groups', () => {
  test('Reception registers a group with subcategory, laps and beeper',
    { tag: ['@critical', '@e2e', '@recepcion', '@RECEP-E2E-001'] },
    async ({ page, adminApi }) => {
      const { game, recepcion } = await setup(adminApi, page);
      const nombre = uniqueName('Familia Pérez');

      await recepcion.fillGroup({ juego: game.nombre, subcategoria: 'Adultos', vueltas: 5, nombre, miembros: 3 });
      const beeper = await recepcion.beeperInput.inputValue();
      await recepcion.submit();

      await recepcion.expectToast(`${nombre} – Beeper ${beeper} registrado`);
      await recepcion.openGameTab(game.nombre);
      const card = recepcion.waitingCard(nombre);
      await expect(card).toContainText('3 personas');
      await expect(card).toContainText('Adultos');
      await expect(card).toContainText('5 vueltas');
      await expect(card).toContainText(beeper);

      const [turn] = await adminApi.turnsOf(game);
      expect(turn).toMatchObject({ nombre_cliente: nombre, biper_numero: beeper, vueltas: 5, cantidad_miembros: 3, estado: 'esperando', etapa_actual_nombre: 'Charla' });
    });

  test('Laps are required when the game uses them',
    { tag: ['@high', '@e2e', '@recepcion', '@RECEP-E2E-002'] },
    async ({ page, adminApi }) => {
      const { game, recepcion } = await setup(adminApi, page);

      await recepcion.fillGroup({ juego: game.nombre, subcategoria: 'Adultos', nombre: uniqueName('Sin vueltas'), miembros: 2 });
      await expect(recepcion.lapsSelect).toBeVisible();
      await recepcion.submit();

      await recepcion.expectToast('Seleccioná la cantidad de vueltas para este juego');
      expect(await adminApi.turnsOf(game)).toHaveLength(0);

      // The server enforces it too, not only the form.
      const res = await page.request.post('/api/turnos', {
        data: { atraccion_id: game.id, biper_numero: '777', nombre_cliente: 'API', cantidad_miembros: 2, subcategoria_id: game.subcategorias[0].id },
      });
      expect(res.status()).toBe(400);
      expect((await res.json()).error).toBe('Debe seleccionar la cantidad de vueltas para este juego');
    });
});

test.describe('Recepción - combine waiting groups', () => {
  test('Two waiting groups with the same laps are combined into one card',
    { tag: ['@critical', '@e2e', '@recepcion', '@RECEP-E2E-003'] },
    async ({ page, adminApi }) => {
      const { game, recepcion } = await setup(adminApi, page);
      const a = await adminApi.createTurn(game, { nombre: uniqueName('Grupo A'), vueltas: 5, miembros: 2 });
      const b = await adminApi.createTurn(game, { nombre: uniqueName('Grupo B'), vueltas: 5, miembros: 3 });
      await page.reload();
      await recepcion.openGameTab(game.nombre);

      await recepcion.combine(a.nombre_cliente!, [b.nombre_cliente!]);

      await recepcion.expectToast('Grupos combinados (5 personas)');
      await expect(recepcion.waitingCards()).toHaveCount(1);
      const card = recepcion.waitingCard(`${a.nombre_cliente} + ${b.nombre_cliente}`);
      await expect(card).toContainText('Combinado');
      await expect(card).toContainText('5 personas');
      await expect(card.getByRole('button', { name: iconName('Llamar juntos') })).toBeVisible();

      const [ta, tb] = [await adminApi.turn(a.id, game), await adminApi.turn(b.id, game)];
      expect(ta.combinacion_id).not.toBeNull();
      expect(tb.combinacion_id).toBe(ta.combinacion_id);
    });

  test('Groups with different laps cannot be combined',
    { tag: ['@critical', '@e2e', '@recepcion', '@RECEP-E2E-004'] },
    async ({ page, adminApi }) => {
      const { game, recepcion } = await setup(adminApi, page);
      const a = await adminApi.createTurn(game, { nombre: uniqueName('Cinco'), vueltas: 5 });
      const b = await adminApi.createTurn(game, { nombre: uniqueName('Diez'), vueltas: 10 });
      await page.reload();
      await recepcion.openGameTab(game.nombre);

      await recepcion.openCombine(a.nombre_cliente!);

      await expect(recepcion.combineCandidate(b.nombre_cliente!)).toBeDisabled();
      await expect(recepcion.combineDialog).toContainText('Otra cantidad de vueltas (10)');
      await expect(recepcion.combineDialog.getByRole('button', { name: iconName('Combinar') })).toBeDisabled();

      const res = await page.request.post('/api/turnos/combinar', { data: { turno_id: a.id, con: [b.id] } });
      expect(res.status()).toBe(400);
      expect((await res.json()).error).toBe('Solo se pueden combinar grupos con la misma cantidad de vueltas');
      expect((await adminApi.turn(b.id, game)).combinacion_id).toBeNull();
    });
});

test.describe('Recepción - XSS regression', () => {
  test('A malicious client name renders as text and its card buttons do not execute it',
    { tag: ['@critical', '@e2e', '@recepcion', '@security', '@RECEP-E2E-005'] },
    async ({ page, adminApi }) => {
      const { game, recepcion } = await setup(adminApi, page);
      await adminApi.createTurn(game, { nombre: XSS_NAME, vueltas: 5 });
      await page.reload();
      await recepcion.openGameTab(game.nombre);

      const card = recepcion.waitingCard(XSS_NAME);
      await expect(card.getByText(XSS_NAME, { exact: true })).toBeVisible();

      await card.getByTitle('Editar turno').click();
      const editDialog = recepcion.dialog('Editar turno');
      await expect(editDialog).toBeVisible();
      await editDialog.getByRole('button', { name: iconName('Cancelar') }).click();
      await expect(editDialog).toBeHidden();

      await card.getByTitle('Eliminar turno').click();
      const deleteDialog = recepcion.dialog('Eliminar turno');
      await expect(deleteDialog).toContainText(`Familia: ${XSS_NAME}`);
      await deleteDialog.getByRole('button', { name: iconName('Cancelar') }).click();
      await expect(deleteDialog).toBeHidden();

      await recepcion.callGroup(XSS_NAME);
      await recepcion.expectToast(`${XSS_NAME} llamado a jugar`);
      await expect(recepcion.activeCard(XSS_NAME).getByText(XSS_NAME, { exact: true })).toBeVisible();

      await expectNoXss(page);
    });

  test('Confirming "Finalizar" on a playing card does not execute the client name',
    { tag: ['@critical', '@e2e', '@recepcion', '@security', '@RECEP-E2E-006'] },
    async ({ page, adminApi }) => {
      const { game, recepcion } = await setup(adminApi, page);
      const turn = await adminApi.createTurn(game, { nombre: XSS_NAME, vueltas: 5 });
      await adminApi.call(turn);
      await page.reload();
      await recepcion.openGameTab(game.nombre);

      await recepcion.activeCard(XSS_NAME).getByRole('button', { name: iconName('Finalizar') }).click();
      const confirm = recepcion.dialog('¿Finalizar turno?');
      await expect(confirm).toContainText(XSS_NAME);
      await confirm.getByRole('button', { name: iconName('Sí, finalizar') }).click();
      await recepcion.expectToast('finalizado');

      await expectNoXss(page);
    });
});
