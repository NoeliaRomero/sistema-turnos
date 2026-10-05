import { expect, type Locator, type Page } from '@playwright/test';
import { BasePage, iconName } from '../base-page';

export interface GameForm {
  nombre: string;
  etapas: string[];
  subcategorias: string[];
  vueltas: number[];
  llamadoAutomaticoSeg?: number;
}

export class AdminPage extends BasePage {
  readonly gamesTab: Locator;
  readonly newGameButton: Locator;

  constructor(page: Page) {
    super(page);
    // Bootstrap gives the nav buttons role="tab". Bootstrap Icons add a glyph to
    // accessible names, so names are matched with an end-anchored regex, not `exact`.
    this.gamesTab      = page.getByRole('tab', { name: iconName('Juegos') });
    this.newGameButton = page.getByRole('button', { name: 'Nuevo Juego' });
  }

  async goto(): Promise<void> {
    await super.goto('/admin.html');
  }

  async openGamesTab(): Promise<void> {
    await this.gamesTab.click();
    await this.newGameButton.waitFor();
  }

  get gameModal(): Locator {
    return this.page.getByRole('dialog').filter({ has: this.page.getByLabel('Nombre del juego') });
  }

  gameRow(nombre: string): Locator {
    return this.page.getByRole('row').filter({ hasText: nombre });
  }

  async createGame(form: GameForm): Promise<void> {
    await this.newGameButton.click();
    const modal = this.gameModal;
    await modal.getByLabel('Nombre del juego').fill(form.nombre);

    // Stages: enabling the switch adds the first row.
    await modal.getByLabel('Utilizar etapas').check();
    for (let i = 1; i < form.etapas.length; i++) {
      await modal.getByRole('button', { name: 'Agregar etapa' }).click();
    }
    const stageInputs = modal.getByPlaceholder('Nombre de la etapa');
    for (const [i, nombre] of form.etapas.entries()) await stageInputs.nth(i).fill(nombre);

    await modal.getByLabel('¿Este juego tiene subcategorías?').check();
    for (let i = 1; i < form.subcategorias.length; i++) {
      await modal.getByRole('button', { name: 'Agregar subcategoría' }).click();
    }
    const subInputs = modal.getByPlaceholder('Nombre de la subcategoría');
    for (const [i, nombre] of form.subcategorias.entries()) await subInputs.nth(i).fill(nombre);

    await modal.getByLabel('¿Este juego usa vueltas?').check();
    for (let i = 1; i < form.vueltas.length; i++) {
      await modal.getByRole('button', { name: 'Agregar opción' }).click();
    }
    const lapInputs = modal.getByPlaceholder('Cantidad de vueltas');
    for (const [i, n] of form.vueltas.entries()) await lapInputs.nth(i).fill(String(n));

    if (form.llamadoAutomaticoSeg) {
      await modal.getByLabel('Llamado automático del siguiente turno').check();
      await modal.getByLabel('Tiempo entre llamados').fill(String(form.llamadoAutomaticoSeg));
    }

    await modal.getByRole('button', { name: 'Guardar' }).click();
    await this.expectToast('Juego creado');
  }

  /** Opens the edit modal of `nombre` and replaces lap option `from` with `to`. */
  async editLapOption(nombre: string, from: number, to: number): Promise<void> {
    await this.gameRow(nombre).getByRole('button', { name: 'Editar' }).click();
    const modal = this.gameModal;
    // The modal is filled from the API first and shown afterwards.
    await expect(modal.getByText('Editar Juego')).toBeVisible();
    const lapInputs = modal.getByPlaceholder('Cantidad de vueltas');
    const values = await lapInputs.evaluateAll(els => els.map(e => (e as HTMLInputElement).value));
    const idx = values.indexOf(String(from));
    if (idx === -1) throw new Error(`Lap option ${from} not found in ${values.join(', ')}`);
    await lapInputs.nth(idx).fill(String(to));
    await modal.getByRole('button', { name: 'Guardar' }).click();
    await this.expectToast('Juego actualizado');
  }
}
