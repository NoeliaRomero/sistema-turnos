import { type Locator, type Page } from '@playwright/test';
import { BasePage } from '../base-page';
import type { Credentials } from '../helpers';

export class LoginPage extends BasePage {
  readonly usernameInput: Locator;
  readonly passwordInput: Locator;
  readonly submitButton: Locator;
  readonly errorMessage: Locator;

  constructor(page: Page) {
    super(page);
    this.usernameInput = page.getByLabel('Usuario');
    this.passwordInput = page.getByLabel('Contraseña');
    this.submitButton  = page.getByRole('button', { name: 'Ingresar' });
    this.errorMessage  = page.getByRole('alert');
  }

  async goto(): Promise<void> {
    await super.goto('/login.html');
  }

  async login(creds: Credentials): Promise<void> {
    await this.usernameInput.fill(creds.username);
    await this.passwordInput.fill(creds.password);
    await this.submitButton.click();
  }
}
