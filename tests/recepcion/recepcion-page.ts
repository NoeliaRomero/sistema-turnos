import { expect, type Locator, type Page } from '@playwright/test';
import { BasePage, iconName } from '../base-page';

export interface GroupForm {
  juego: string;
  nombre: string;
  miembros: number;
  subcategoria?: string;
  vueltas?: number;
  beeper?: string;
}

export class RecepcionPage extends BasePage {
  readonly gameSelect: Locator;
  readonly subcategorySelect: Locator;
  readonly lapsSelect: Locator;
  readonly beeperInput: Locator;
  readonly nameInput: Locator;
  readonly membersInput: Locator;
  readonly submitButton: Locator;

  constructor(page: Page) {
    super(page);
    // getByRole ignores the hidden "Editar turno" modal, which reuses some labels.
    this.gameSelect        = page.getByRole('combobox', { name: 'Juego' });
    this.subcategorySelect = page.getByRole('combobox', { name: 'Subcategoría' });
    this.lapsSelect        = page.getByRole('combobox', { name: 'Vueltas' });
    this.beeperInput       = page.getByRole('spinbutton', { name: 'Número de Beeper' });
    this.nameInput         = page.getByRole('textbox', { name: 'Familia / Nombre del grupo' });
    this.membersInput      = page.getByRole('spinbutton', { name: 'Cantidad de miembros' });
    this.submitButton      = page.getByRole('button', { name: 'Registrar en Cola' });
  }

  /** Opens the page and waits until the game list and the auto beeper are loaded. */
  async goto(): Promise<void> {
    await super.goto('/recepcion.html');
    await expect(this.beeperInput).not.toHaveValue('');
  }

  async selectGame(nombre: string): Promise<void> {
    const value = await this.gameSelect.locator('option', { hasText: nombre }).getAttribute('value');
    await this.gameSelect.selectOption(value!);
  }

  async fillGroup(form: GroupForm): Promise<void> {
    await this.selectGame(form.juego);
    if (form.subcategoria) await this.subcategorySelect.selectOption({ label: form.subcategoria });
    if (form.vueltas)      await this.lapsSelect.selectOption({ label: `${form.vueltas} vueltas` });
    if (form.beeper)       await this.beeperInput.fill(form.beeper);
    await this.nameInput.fill(form.nombre);
    await this.membersInput.fill(String(form.miembros));
  }

  async submit(): Promise<void> {
    await this.submitButton.click();
  }

  // ── Queue (one tab per game) ─────────────────────────────────────────────────
  gameTab(nombre: string): Locator {
    return this.page.getByRole('tab', { name: nombre });
  }

  async openGameTab(nombre: string): Promise<void> {
    await this.gameTab(nombre).click();
    await expect(this.gameTab(nombre)).toHaveClass(/active/);
  }

  get activePanel(): Locator {
    return this.page.getByRole('tabpanel').filter({ visible: true });
  }

  /**
   * Queue cards have no ARIA role/test id: `.turno-row` is the only stable hook
   * (waiting cards also carry `.turno-espera`, playing/called ones `.jugando`).
   */
  waitingCard(nombre: string): Locator {
    return this.activePanel.locator('.turno-row.turno-espera').filter({ hasText: nombre });
  }

  activeCard(nombre: string): Locator {
    return this.activePanel.locator('.turno-row.jugando').filter({ hasText: nombre });
  }

  waitingCards(): Locator {
    return this.activePanel.locator('.turno-row.turno-espera');
  }

  // ── Combine modal ────────────────────────────────────────────────────────────
  get combineDialog(): Locator {
    return this.dialog('Combinar grupos');
  }

  async openCombine(baseNombre: string): Promise<void> {
    await this.waitingCard(baseNombre).getByRole('button', { name: iconName('Combinar') }).click();
    await expect(this.combineDialog).toBeVisible();
  }

  combineCandidate(nombre: string): Locator {
    return this.combineDialog.getByRole('checkbox', { name: nombre });
  }

  async combine(baseNombre: string, conNombres: string[]): Promise<void> {
    await this.openCombine(baseNombre);
    for (const n of conNombres) await this.combineCandidate(n).check();
    await this.combineDialog.getByRole('button', { name: iconName('Combinar') }).click();
    await expect(this.combineDialog).toBeHidden();
  }

  async callGroup(nombre: string): Promise<void> {
    await this.waitingCard(nombre).getByRole('button', { name: /^\W*Llamar( juntos)?$/ }).click();
  }
}
