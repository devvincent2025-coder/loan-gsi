import { expect, test, type Page } from '@playwright/test';

const PASSWORD = 'Damez@Demo2026';

async function login(page: Page, email: string, attempt = 0): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Continue' }).click();
  // 2FA step: fetch the demo code straight from the API (demo mode only)
  const res = await page.request.get(`/api/v1/auth/demo-totp?email=${encodeURIComponent(email)}`);
  expect(res.ok()).toBeTruthy();
  const { code } = (await res.json()) as { code: string };
  const first = page.getByLabel('One-time code digit 1');
  await first.click();
  await page.keyboard.type(code);
  try {
    await page.waitForURL('**/dashboard', { timeout: 8000 });
  } catch (e) {
    // TOTP codes are single-use (replay protection): if the same 30s step was already used, wait for the next one and retry
    if (attempt >= 1) throw e;
    await page.waitForTimeout((31 - (Math.floor(Date.now() / 1000) % 30)) * 1000);
    await login(page, email, attempt + 1);
  }
}

async function logout(page: Page) {
  await page.getByRole('button', { name: 'User menu' }).click();
  await page.getByRole('menuitem', { name: /sign out/i }).click();
  await page.waitForURL('**/login');
}

test.describe.configure({ mode: 'serial' });

test('admin sees dashboard KPIs and can edit the permission matrix', async ({ page }) => {
  await login(page, 'admin@damez.ng');
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await expect(page.getByTestId('kpi-value').first()).toBeVisible();

  await page.goto('/roles');
  const cell = page.getByRole('checkbox', { name: 'report:export for Customer Support' });
  await cell.scrollIntoViewIfNeeded();
  const before = await cell.getAttribute('aria-checked');
  await cell.click();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Review permission changes')).toBeVisible();
  await page.getByRole('button', { name: 'Confirm and save' }).click();
  await expect(page.getByText(/Saved permissions/)).toBeVisible();
  // revert so the test is repeatable
  await expect(cell).toHaveAttribute('aria-checked', before === 'true' ? 'false' : 'true');
  await cell.click();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await page.getByRole('button', { name: 'Confirm and save' }).click();
  await logout(page);
});

test('maker-checker: officer submits a WAIVER, ceo approves', async ({ page }) => {
  const summary = `E2E waiver ${Date.now()}`;
  await login(page, 'officer@damez.ng');
  await page.goto('/approvals');
  await page.getByRole('button', { name: 'New request' }).click();
  await page.locator('#nr-type').selectOption({ label: 'Fee / interest waiver' });
  await page.getByLabel('Summary').fill(summary);
  await page.getByLabel('Amount').fill('20000');
  await page.getByRole('button', { name: 'Submit request' }).click();
  await expect(page.getByText('Request submitted for approval')).toBeVisible();
  await logout(page);

  await login(page, 'ceo@damez.ng');
  await page.goto('/approvals');
  await page.getByText(summary).click();
  await page.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByText(/^Approved/).first()).toBeVisible();
});
