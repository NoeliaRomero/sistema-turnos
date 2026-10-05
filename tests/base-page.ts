import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Accessible-name matcher for buttons/tabs that start with a Bootstrap Icon:
 * the icon glyph becomes part of the name, so `exact: true` never matches.
 * `iconName('Llegó')` matches " Llegó" but not " No Llegó".
 */
export function iconName(text: string): RegExp {
  return new RegExp(`^\\W*${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
}

/** Parent class for every page object. */
export class BasePage {
  constructor(readonly page: Page) {}

  async goto(path: string): Promise<void> {
    await this.page.goto(path);
    await this.page.waitForLoadState('domcontentloaded');
  }

  /** Bootstrap toasts are rendered with role="alert" inside the toast container. */
  toast(text: string | RegExp): Locator {
    return this.page.getByRole('alert').filter({ hasText: text });
  }

  async expectToast(text: string | RegExp): Promise<void> {
    await expect(this.toast(text).first()).toBeVisible();
  }

  /** A visible Bootstrap modal (role="dialog" is set by Bootstrap when shown). */
  dialog(text: string | RegExp): Locator {
    return this.page.getByRole('dialog').filter({ hasText: text });
  }

  /** Accepts the next native confirm() dialog. */
  acceptNextConfirm(): void {
    this.page.once('dialog', d => d.accept());
  }
}
