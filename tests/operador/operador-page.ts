import { expect, type Locator, type Page } from '@playwright/test';
import { BasePage, iconName } from '../base-page';

export class OperadorPage extends BasePage {
  readonly gameFilter: Locator;

  constructor(page: Page) {
    super(page);
    this.gameFilter = page.getByRole('combobox', { name: 'Atracción' });
  }

  /** Opens the panel; an operator with an assigned game gets the filter locked to it. */
  async goto(): Promise<void> {
    await super.goto('/operador.html');
    await expect(this.gameFilter).toBeDisabled();
    await this.takeAllStages();
  }

  /**
   * On login the operator must pick the stage(s) they are in charge of (games
   * without stages are assigned automatically). Tests run one operator per
   * game, so the operator takes every free stage.
   */
  async takeAllStages(): Promise<void> {
    const modal = this.page.locator('#modalPuesto');
    const badge = this.page.locator('#puestoActual');
    await expect(modal.and(this.page.locator('.show')).or(badge.and(this.page.locator(':not(.d-none)')))).toBeVisible();
    if (await modal.isVisible()) {
      for (const box of await modal.locator('input[type=checkbox]:not([disabled])').all()) await box.check();
      await modal.getByRole('button', { name: 'Confirmar' }).click();
      await expect(modal).toBeHidden();
    }
    await expect(this.page.locator('#avisoLectura')).toBeHidden();
  }

  /**
   * Turn cards have no ARIA role/test id: `.turno-card` is the only stable hook
   * (state classes: `.esperando`, `.llamado`, `.jugando`).
   */
  card(nombre: string): Locator {
    return this.page.locator('.turno-card').filter({ hasText: nombre });
  }

  async expectCalled(nombre: string): Promise<void> {
    await expect(this.card(nombre)).toContainText('Llamado');
    await expect(this.card(nombre).getByRole('button', { name: iconName('Llegó') })).toBeVisible();
  }

  async expectPlaying(nombre: string, etapa?: string): Promise<void> {
    await expect(this.card(nombre)).toContainText('Jugando');
    if (etapa) await expect(this.card(nombre)).toContainText(`Etapa: ${etapa}`);
  }

  async call(nombre: string): Promise<void> {
    await this.card(nombre).getByRole('button', { name: iconName('Llamar') }).click();
  }

  async arrived(nombre: string): Promise<void> {
    await this.card(nombre).getByRole('button', { name: iconName('Llegó') }).click();
  }

  async finishStage(nombre: string): Promise<void> {
    await this.card(nombre).getByRole('button', { name: iconName('Finalizar Etapa') }).click();
  }

  async finish(nombre: string): Promise<void> {
    await this.card(nombre).getByRole('button', { name: iconName('Finalizar') }).click();
  }

  /** "No Llegó" asks for a native confirm() first. */
  async noShow(nombre: string): Promise<void> {
    this.acceptNextConfirm();
    await this.card(nombre).getByRole('button', { name: iconName('No Llegó') }).click();
    await this.expectToast('Marcado como "No llegó"');
  }
}
