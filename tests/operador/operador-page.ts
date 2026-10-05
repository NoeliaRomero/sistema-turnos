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
