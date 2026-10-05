import { test, expect, ADMIN } from '../helpers';
import { LoginPage } from './login-page';

test.describe('Login', () => {
  test('Admin with valid credentials is redirected to the admin panel',
    { tag: ['@critical', '@e2e', '@login', '@LOGIN-E2E-001'] },
    async ({ page }) => {
      const loginPage = new LoginPage(page);
      await loginPage.goto();

      await loginPage.login(ADMIN);

      await expect(page).toHaveURL(/\/admin\.html$/);
      await expect(page.getByText('Administración')).toBeVisible();
    });

  test('Wrong password shows an error and stays on the login page',
    { tag: ['@critical', '@e2e', '@login', '@LOGIN-E2E-002'] },
    async ({ page }) => {
      const loginPage = new LoginPage(page);
      await loginPage.goto();

      await loginPage.login({ username: ADMIN.username, password: 'wrong-password' });

      await expect(loginPage.errorMessage).toHaveText('Usuario o contraseña incorrectos');
      await expect(page).toHaveURL(/\/login\.html$/);
    });
});
