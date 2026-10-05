import { type Locator, type Page } from '@playwright/test';
import { BasePage } from '../base-page';

/** Public TV screen (no login). */
export class PantallaPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  async goto(): Promise<void> {
    await super.goto('/pantalla.html');
  }

  /**
   * The TV markup has no ARIA roles/test ids: `.juego-card`, `.turno-activo`
   * and `.cola-item` are the only stable hooks.
   */
  gameCard(nombre: string): Locator {
    return this.page.locator('.juego-card').filter({ hasText: nombre });
  }

  activeGroup(juego: string, grupo: string): Locator {
    return this.gameCard(juego).locator('.turno-activo').filter({ hasText: grupo });
  }

  queuedGroup(juego: string, grupo: string): Locator {
    return this.gameCard(juego).locator('.cola-item').filter({ hasText: grupo });
  }
}
