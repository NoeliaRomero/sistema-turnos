import { test, expect, loginAs, uniqueName, expectNoXss, XSS_NAME, type ApiClient, type Credentials, type Game } from '../helpers';
import type { Page } from '@playwright/test';
import { OperadorPage } from './operador-page';
import { RecepcionPage } from '../recepcion/recepcion-page';

/** Operator session (own browser context) assigned to `game`. */
async function openOperator(openSession: (c: Credentials) => Promise<Page>, adminApi: ApiClient, game: Game): Promise<OperadorPage> {
  const user = await adminApi.createUser({ rol: 'operador', atraccionId: game.id });
  const opPage = await openSession(user);
  const operador = new OperadorPage(opPage);
  await operador.goto();
  return operador;
}

async function openRecepcion(page: Page, adminApi: ApiClient, game: Game): Promise<RecepcionPage> {
  await loginAs(page, await adminApi.createUser({ rol: 'recepcion' }));
  const recepcion = new RecepcionPage(page);
  await recepcion.goto();
  await recepcion.openGameTab(game.nombre);
  return recepcion;
}

test.describe('Operador - combined groups act as one', () => {
  test('A combined group is called, arrives, advances and finishes together',
    { tag: ['@critical', '@e2e', '@operador', '@OPER-E2E-001'] },
    async ({ page, openSession, adminApi }) => {
      const game = await adminApi.createGame({ etapas: ['Charla', 'En pista'], vueltas: [5, 10] });
      const a = await adminApi.createTurn(game, { nombre: uniqueName('Combo A'), vueltas: 5 });
      const b = await adminApi.createTurn(game, { nombre: uniqueName('Combo B'), vueltas: 5 });
      await adminApi.combine(a, [b]);
      const [nameA, nameB] = [a.nombre_cliente!, b.nombre_cliente!];

      const recepcion = await openRecepcion(page, adminApi, game);
      const operador  = await openOperator(openSession, adminApi, game);

      // Reception calls the combination: both groups are called.
      await recepcion.callGroup(`${nameA} + ${nameB}`);
      await recepcion.expectToast(`Combinación llamada a jugar – beepers ${a.biper_numero}, ${b.biper_numero}`);
      await expect(recepcion.activeCard(nameA)).toContainText('LLAMADO');
      await expect(recepcion.activeCard(nameB)).toContainText('LLAMADO');
      await operador.expectCalled(nameA);
      await operador.expectCalled(nameB);

      // "Llegó" on one of them → both playing.
      await operador.arrived(nameA);
      await operador.expectPlaying(nameA, 'Charla');
      await operador.expectPlaying(nameB, 'Charla');
      await adminApi.expectStates(game, [a.id, b.id], 'jugando');

      // Advance the stage on one of them → both advance.
      await operador.finishStage(nameA);
      await operador.expectPlaying(nameA, 'En pista');
      await operador.expectPlaying(nameB, 'En pista');

      // Finish on one of them → both finish.
      await operador.finish(nameA);
      await expect(operador.card(nameA)).toHaveCount(0);
      await expect(operador.card(nameB)).toHaveCount(0);
      await adminApi.expectStates(game, [a.id, b.id], 'finalizado');

    });

  test('"No llegó" sends the whole combination to the end of the queue, still combined',
    { tag: ['@critical', '@e2e', '@operador', '@OPER-E2E-002'] },
    async ({ page, openSession, adminApi }) => {
      const game = await adminApi.createGame({ etapas: ['Charla', 'En pista'], vueltas: [5, 10] });
      const a = await adminApi.createTurn(game, { nombre: uniqueName('NoShow A'), vueltas: 5 });
      const b = await adminApi.createTurn(game, { nombre: uniqueName('NoShow B'), vueltas: 5 });
      await adminApi.combine(a, [b]);
      const c = await adminApi.createTurn(game, { nombre: uniqueName('NoShow C'), vueltas: 5 });
      await adminApi.call(a);
      const combinacionId = (await adminApi.turn(a.id, game)).combinacion_id;

      const operador = await openOperator(openSession, adminApi, game);
      await operador.expectCalled(a.nombre_cliente!);
      await operador.noShow(a.nombre_cliente!);

      await adminApi.expectStates(game, [a.id, b.id, c.id], 'esperando');
      const turns = await adminApi.turnsOf(game);
      const queue = turns.filter(t => t.estado === 'esperando').sort((x, y) => x.orden_cola! - y.orden_cola!);
      expect(queue.map(t => t.id)).toEqual([c.id, a.id, b.id]);
      expect(queue.filter(t => t.id !== c.id).map(t => t.combinacion_id)).toEqual([combinacionId, combinacionId]);
      expect(queue.map(t => t.etapa_actual_nombre)).toEqual(['Charla', 'Charla', 'Charla']);

      // Reception sees C first and the combination as a single card behind it.
      const recepcion = await openRecepcion(page, adminApi, game);
      await expect(recepcion.waitingCards()).toHaveCount(2);
      await expect(recepcion.waitingCards().nth(0)).toContainText(c.nombre_cliente!);
      await expect(recepcion.waitingCards().nth(1)).toContainText(`${a.nombre_cliente} + ${b.nombre_cliente}`);
      await expect(recepcion.waitingCards().nth(1)).toContainText('Combinado');

    });
});

test.describe('Operador - auto-call', () => {
  test('When the group in "Charla" moves to "En pista", the next waiting group is called automatically',
    { tag: ['@critical', '@e2e', '@operador', '@OPER-E2E-003'] },
    async ({ openSession, adminApi }) => {
      const game = await adminApi.createGame({ etapas: ['Charla', 'En pista'], llamadoAutomaticoSeg: 2 });
      const first  = await adminApi.createTurn(game, { nombre: uniqueName('Primero') });
      const second = await adminApi.createTurn(game, { nombre: uniqueName('Segundo') });
      await adminApi.call(first);

      const operador = await openOperator(openSession, adminApi, game);
      await operador.expectCalled(first.nombre_cliente!);
      // "Charla" is occupied by the first group: the second one keeps waiting.
      expect((await adminApi.turn(second.id, game)).estado).toBe('esperando');

      await operador.arrived(first.nombre_cliente!);
      await operador.expectPlaying(first.nombre_cliente!, 'Charla');
      await operador.finishStage(first.nombre_cliente!);
      await operador.expectPlaying(first.nombre_cliente!, 'En pista');

      // ~2 s later the server calls the next group on its own (no user behind it).
      await operador.expectCalled(second.nombre_cliente!);
      const called = await adminApi.turn(second.id, game);
      expect(called).toMatchObject({ estado: 'llamado', etapa_actual_nombre: 'Charla' });
      expect((called as unknown as { llamado_por: number | null }).llamado_por).toBeNull();

    });
});

test.describe('Operador - scope', () => {
  test('An operator only sees and acts on turns of the assigned game',
    { tag: ['@critical', '@e2e', '@operador', '@security', '@OPER-E2E-004'] },
    async ({ openSession, adminApi }) => {
      const mine   = await adminApi.createGame();
      const other  = await adminApi.createGame();
      const own    = await adminApi.createTurn(mine,  { nombre: uniqueName('Propio') });
      const called = await adminApi.createTurn(other, { nombre: uniqueName('Ajeno llamado') });
      const queued = await adminApi.createTurn(other, { nombre: uniqueName('Ajeno espera') });
      await adminApi.call(called);

      const operador = await openOperator(openSession, adminApi, mine);
      await expect(operador.card(own.nombre_cliente!)).toBeVisible();
      await expect(operador.card(called.nombre_cliente!)).toHaveCount(0);
      await expect(operador.card(queued.nombre_cliente!)).toHaveCount(0);

      const api = operador.page.request;
      const list = await (await api.get('/api/turnos')).json();
      expect(list.map((t: { atraccion_id: number }) => t.atraccion_id)).toEqual([mine.id]);

      const llamar = await api.put(`/api/turnos/${queued.id}/llamar`, { data: {} });
      expect(llamar.status()).toBe(403);
      expect((await llamar.json()).error).toBe('Solo podés llamar turnos de tu juego asignado');

      const llegar = await api.put(`/api/turnos/${called.id}/llegar`);
      expect(llegar.status()).toBe(403);

      const finalizar = await api.put(`/api/turnos/${called.id}/finalizar`);
      expect(finalizar.status()).toBe(403);

      const noLlego = await api.put(`/api/turnos/${called.id}/cancelar`);
      expect(noLlego.status()).toBe(403);

      expect((await adminApi.turn(called.id, other)).estado).toBe('llamado');
      expect((await adminApi.turn(queued.id, other)).estado).toBe('esperando');

    });
});

test.describe('Operador - XSS regression', () => {
  test('A malicious client name renders as text through call, arrival and finish',
    { tag: ['@critical', '@e2e', '@operador', '@security', '@OPER-E2E-005'] },
    async ({ openSession, adminApi }) => {
      const game = await adminApi.createGame();
      const turn = await adminApi.createTurn(game, { nombre: XSS_NAME });
      const operador = await openOperator(openSession, adminApi, game);

      await expect(operador.card(XSS_NAME).getByText(XSS_NAME, { exact: true })).toBeVisible();
      await operador.call(XSS_NAME);
      await operador.expectCalled(XSS_NAME);
      await operador.arrived(XSS_NAME);
      await operador.expectPlaying(XSS_NAME);
      await operador.finish(XSS_NAME);
      await expect(operador.card(XSS_NAME)).toHaveCount(0);
      await adminApi.expectStates(game, [turn.id], 'finalizado');

      await expectNoXss(operador.page);
    });

  test('A malicious beeper number is rejected and never reaches the operator cards',
    { tag: ['@high', '@e2e', '@operador', '@security', '@OPER-E2E-006'] },
    async ({ openSession, adminApi }) => {
      // The API only accepts digits as a beeper number (it used to accept
      // "7<img ...>" because parseInt ignores the trailing text). The operator
      // cards also escape biper_numero, as a second barrier for old data.
      const game = await adminApi.createGame();
      const evilBeeper = `${Math.floor(Math.random() * 800) + 900}<img src=x onerror="window.__xss=1">`;
      const res = await adminApi.tryCreateTurn(game, { nombre: uniqueName('Beeper malo'), biper: evilBeeper });
      expect(res.status()).toBe(400);

      const operador = await openOperator(openSession, adminApi, game);
      await expect(operador.card('Beeper malo')).toHaveCount(0);
      await expectNoXss(operador.page);
    });
});
