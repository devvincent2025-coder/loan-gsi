import { expect, test, type Page } from '@playwright/test';

/**
 * Customer portal happy path against the real stack in DEMO_MODE with mock providers:
 * register -> OTP (demo code chip) -> onboarding (email, profile, KYC consent, BVN, NIN, face mock PASS, bank, bureau consent) -> apply -> eligibility result.
 * BVN/NIN ending in "00" = KYC pass + CLEAN bureau profile (see shared mock-profiles).
 */
test.describe.configure({ mode: 'serial' });

const unique = () => String(Date.now()).slice(-8);

async function continueStep(page: Page, name: string | RegExp = 'Continue') {
  await page.getByRole('button', { name }).first().click();
}

// unique per run (BVN/NIN are unique across customers); trailing 00 = KYC pass + clean bureau history
const rand7 = () => String(Math.floor(Math.random() * 1e7)).padStart(7, '0');
const BVN = `22${rand7()}00`;
const NIN = `33${rand7()}00`;

test('register, onboard with mock KYC and get an eligibility result', async ({ page }) => {
  const phone = `080${unique()}`;
  await page.emulateMedia({ reducedMotion: 'reduce' });

  // ── register ──
  await page.goto('/portal/register');
  await page.getByLabel('First name').fill('Ada');
  await page.getByLabel('Last name').fill('Portal');
  await page.getByLabel('Phone number').fill(phone);
  await page.getByRole('button', { name: 'Read the privacy notice' }).click();
  await expect(page.getByText(/Nigeria Data Protection Act/)).toBeVisible();
  await page.getByLabel(/accept the privacy notice/i).click();
  await page.getByRole('button', { name: 'Continue' }).click();

  // ── OTP with the demo chip ──
  const chip = page.getByTestId('demo-code-chip');
  await expect(chip).toContainText('Demo mode: your code is');
  await chip.getByRole('button', { name: 'Use code' }).click();
  await page.waitForURL('**/portal');
  await expect(page.getByRole('heading', { name: /Hello, Ada/ })).toBeVisible();
  await expect(page.getByTestId('onboarding-progress')).toBeVisible();
  await expect(page.getByRole('button', { name: /Apply for a loan/ })).toBeDisabled();

  // ── onboarding wizard ──
  await page.getByRole('link', { name: /Continue/ }).click();
  await page.waitForURL('**/portal/onboarding');

  // email (skipped when there is no email on file and the step is optional)
  if (await page.getByTestId('step-EMAIL').isVisible().catch(() => false)) {
    const skip = page.getByRole('button', { name: 'Skip for now' });
    if (await skip.isVisible().catch(() => false)) await skip.click();
  }

  // profile
  await expect(page.getByTestId('step-PROFILE')).toBeVisible();
  await page.getByLabel('Date of birth').fill('1990-05-17');
  await page.getByLabel('Street address').fill('12 Admiralty Way');
  await page.getByLabel('City / town').fill('Lekki');
  await page.getByLabel('State').selectOption('Lagos');
  await page.getByLabel('Employment status').selectOption('EMPLOYED');
  await page.getByLabel('Employer / business name').fill('Acme Ltd');
  await page.getByLabel('Monthly income').fill('450000');
  await page.getByLabel(/Salary day/).fill('25');
  await page.getByRole('button', { name: 'Save and continue' }).click();

  // KYC consent gate, then BVN
  await expect(page.getByTestId('step-BVN')).toBeVisible();
  await expect(page.getByText('Identity verification').first()).toBeVisible();
  await page.getByLabel(/I have read and understood this/).click();
  await page.getByRole('button', { name: 'I agree and continue' }).click();
  await page.getByLabel('Bank Verification Number (BVN)', { exact: true }).first().fill(BVN);
  await page.getByRole('button', { name: 'Verify BVN' }).click();
  // the wizard advances on success: confirm through the progress tracker (server state), not a transient screen
  await expect(page.getByRole('button', { name: /BVN verified/ }).first()).toBeVisible({ timeout: 15_000 });

  // NIN (open it from the tracker if the wizard did not move on by itself)
  const ninStep = page.getByTestId('step-NIN');
  if (!(await ninStep.isVisible().catch(() => false))) await page.getByRole('button', { name: /Add your NIN/ }).first().click();
  await expect(ninStep).toBeVisible();
  await page.getByLabel('National Identification Number (NIN)', { exact: true }).first().fill(NIN);
  await page.getByRole('button', { name: 'Verify NIN' }).click();
  await expect(page.getByRole('button', { name: /NIN verified|Tier 2/ }).first()).toBeVisible({ timeout: 15_000 });

  // face (mock mode: scenario PASS)
  const faceStep = page.getByTestId('step-FACE');
  if (!(await faceStep.isVisible().catch(() => false))) await page.getByRole('button', { name: /Take a selfie/ }).first().click();
  await expect(faceStep).toBeVisible();
  await page.context().grantPermissions([]); // camera denied on purpose: the placeholder path must work
  await page.getByRole('button', { name: 'Start face check' }).click();
  await expect(page.getByTestId('face-mock')).toBeVisible();
  await page.getByLabel('Demo mode scenario').selectOption('PASS');
  await page.getByRole('button', { name: /Start liveness check/ }).click();
  const capture = page.getByRole('button', { name: /Capture/ });
  await expect(capture).toBeEnabled({ timeout: 15_000 });
  await capture.click();
  await expect(page.getByTestId('face-result')).toHaveAttribute('data-status', 'PASSED', { timeout: 30_000 });
  await continueStep(page);

  // bank account
  await expect(page.getByTestId('step-BANK_ACCOUNT')).toBeVisible();
  await page.getByLabel('Bank', { exact: true }).first().selectOption({ label: 'Access Bank' });
  await page.getByLabel(/Account number/).first().fill('0123456780');
  await page.getByRole('button', { name: 'Check account' }).click();
  await expect(page.getByTestId('bank-confirm')).toBeVisible();
  await page.getByRole('button', { name: 'Yes, that is me' }).click({ force: true });

  // documents + address are optional here: continue/skip
  for (const key of ['DOCUMENTS', 'ADDRESS']) {
    await expect(page.getByTestId(`step-${key}`)).toBeVisible();
    const skip = page.getByRole('button', { name: 'Skip for now' });
    if (await skip.isVisible().catch(() => false)) await skip.click();
    else await continueStep(page);
  }

  // bureau consent
  await expect(page.getByTestId('step-BUREAU_CONSENT')).toBeVisible();
  await expect(page.getByText(/credit bureaus/).first()).toBeVisible();
  await page.getByLabel(/I agree that Damez may check my credit history/).click();
  await page.getByRole('button', { name: 'I agree' }).click();
  await expect(page.getByText('You are all set!')).toBeVisible();

  // ── apply ──
  await page.getByRole('link', { name: 'Apply for a loan' }).click();
  await page.waitForURL('**/portal/loans/apply');
  await page.getByTestId('product-PERS').click();
  await page.getByRole('radio', { name: '3 mo' }).click();
  await expect(page.getByTestId('monthly-instalment')).toBeVisible();
  await expect(page.getByText('Total cost of credit').first()).toBeVisible();
  await page.getByRole('button', { name: 'Check my eligibility' }).click();
  await expect(page.getByTestId('eligibility-result')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('eligibility-result')).toHaveAttribute('data-outcome', /ELIGIBLE|CONDITIONAL|INELIGIBLE/);
});
