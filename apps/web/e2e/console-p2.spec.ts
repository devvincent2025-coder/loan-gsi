import { expect, test, type Page } from '@playwright/test';

const PASSWORD = 'Damez@Demo2026';

// Same demo-TOTP helper as smoke.spec.ts, including the single-use code replay retry.
async function login(page: Page, email: string, attempt = 0): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Continue' }).click();
  const res = await page.request.get(`/api/v1/auth/demo-totp?email=${encodeURIComponent(email)}`);
  expect(res.ok()).toBeTruthy();
  const { code } = (await res.json()) as { code: string };
  const first = page.getByLabel('One-time code digit 1');
  await first.click();
  await page.keyboard.type(code);
  try {
    await page.waitForURL('**/dashboard', { timeout: 8000 });
  } catch (e) {
    if (attempt >= 1) throw e;
    await page.waitForTimeout((31 - (Math.floor(Date.now() / 1000) % 30)) * 1000);
    await login(page, email, attempt + 1);
  }
}

test('risk manager walks the prompt-2 staff console', async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, 'risk.manager@damez.ng');
await test.step('risk manager: customers list, customer record and credit bureau tab', async () => {
  await page.getByRole('link', { name: 'Customers' }).first().click();
  await expect(page.getByRole('heading', { name: 'Customers' })).toBeVisible();
  const firstRow = page.locator('tbody tr').first();
  await expect(firstRow).toBeVisible();
  // clicking before hydration is a no-op: retry the click until navigation happens
  await expect(async () => { await firstRow.click(); await expect(page).toHaveURL(/\/customers\/[^/?]+/, { timeout: 3000 }); }).toPass({ timeout: 30_000 });
  await expect(page.getByTestId('customer-header')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Overview' })).toBeVisible();

  // the first row can be any customer (e.g. a fresh portal sign-up with no report); use the stable seeded demo customer for the report
  await page.goto('/customers/cust_demo_adaeze?tab=bureau');
  await expect(page.getByTestId('customer-header')).toBeVisible();
  await page.getByRole('tab', { name: 'Credit bureau' }).click();
  // either an existing report (score gauge) or the empty state with a Pull report button
  const gauge = page.getByTestId('score-gauge').first();
  const pull = page.getByRole('button', { name: 'Pull report' });
  await expect(gauge.first()).toBeVisible();
  await expect(page.getByText('Credit facilities')).toBeVisible();
  });

await test.step('risk manager: bureau usage dashboard', async () => {
  await page.goto('/bureau');
  await expect(page.getByRole('heading', { name: 'Credit bureau' })).toBeVisible();
  await expect(page.getByTestId('bureau-usage-kpis')).toBeVisible();
  await expect(page.getByText('Total pulls')).toBeVisible();
  await page.getByRole('tab', { name: 'Distribution' }).click();
  await expect(page.getByText(/feeds the executive dashboards/i)).toBeVisible();
  await page.getByRole('tab', { name: 'Furnishing' }).click();
  await page.getByRole('tab', { name: 'Monitoring' }).click();
  });

await test.step('risk manager: applications list and detail with the state machine', async () => {
  await page.goto('/applications');
  await expect(page.getByRole('heading', { name: 'Applications' })).toBeVisible();
  const rows = page.locator('tbody tr');
  await expect(rows.first()).toBeVisible();
  if ((await rows.count()) > 0 && (await page.getByText('No applications match').count()) === 0) {
    await expect(async () => { await rows.first().click(); await expect(page).toHaveURL(/\/applications\/[^/?]+/, { timeout: 3000 }); }).toPass({ timeout: 30_000 });
    await expect(page.getByTestId('state-machine')).toBeVisible();
  }
  });

await test.step('risk manager: scorecards and what-if simulator', async () => {
  await page.goto('/scorecards');
  await expect(page.getByRole('heading', { name: 'Scorecards' })).toBeVisible();
  await expect(async () => { await page.getByRole('link', { name: /What-if simulator/ }).click(); await expect(page).toHaveURL(/scorecards\/simulator/, { timeout: 3000 }); }).toPass({ timeout: 30_000 });
  await expect(page.getByTestId('simulator')).toBeVisible();
  // result renders once the debounced simulation returns
  await expect(page.getByTestId('eligibility-panel')).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId('outcome-banner')).toBeVisible();
  // tweak a fact and expect the simulation to re-run without errors
  const score = page.getByLabel('Bureau score (blended)').first();
  await score.fill('820');
  await expect(page.getByTestId('eligibility-panel')).toBeVisible();
  });
});
