import { expect, test, type Page } from '@playwright/test';

const PASSWORD = 'Tourwerk2026!';

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test.describe.serial('a dispatch day', () => {
  test('dashboard shows KPIs and the 14-day history', async ({ page }) => {
    await signIn(page, 'dispo@tourwerk.de');
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await expect(page.getByText(/orders for .* are not planned yet/)).toBeVisible();
    await expect(page.getByRole('img', { name: 'Deliveries per day and on-time rate' })).toBeVisible();
    await expect(page.getByRole('cell', { name: /HH-TW 101/ })).toBeVisible();
    await page.screenshot({ path: '../docs/screens/dashboard.png', fullPage: true });
  });

  test('dispatcher optimizes, reviews and commits the routes', async ({ page }) => {
    await signIn(page, 'dispo@tourwerk.de');
    await page.getByRole('link', { name: 'Dispatch', exact: true }).click();
    await page.getByRole('button', { name: 'Fleet what-if' }).click();
    const whatIf = page.getByRole('region', { name: 'Fleet what-if' });
    await expect(whatIf.getByRole('status')).toContainText('Recommended');
    await expect(whatIf.getByText('✓ best')).toBeVisible();
    await whatIf.screenshot({ path: '../docs/screens/whatif.png' });
    await page.getByRole('button', { name: 'Optimize routes' }).click();
    await expect(page.getByRole('heading', { name: 'Proposal' })).toBeVisible();
    await expect(page.getByText(/C\+\+ ALNS/)).toBeVisible();
    await expect(page.getByRole('region', { name: 'Solver insight' })).toContainText(/iterations/);
    await expect(page.getByText('every order fits')).toBeVisible();
    await page.screenshot({ path: '../docs/screens/proposal.png', fullPage: true });
    await page.getByRole('button', { name: /Commit \d+ tours/ }).click();
    await expect(page.getByText(/tours created/)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Tours' })).toBeVisible();
  });

  test('driver delivers a stop and reports a problem on the next', async ({ page }) => {
    await signIn(page, 'fahrer1@tourwerk.de');
    await expect(page.getByRole('heading', { name: 'Today’s tour' })).toBeVisible();
    await page.getByRole('button', { name: 'Start tour' }).click();
    const stops = page.getByRole('listitem');
    await stops.nth(0).getByRole('button', { name: 'Delivered' }).click();
    await expect(stops.nth(0).getByText('Delivered')).toBeVisible();
    await stops.nth(1).getByRole('button', { name: 'Problem' }).click();
    await page.getByRole('button', { name: 'Recipient absent' }).click();
    await expect(stops.nth(1).getByText('Failed')).toBeVisible();
    await page.setViewportSize({ width: 400, height: 860 });
    await page.screenshot({ path: '../docs/screens/driver.png' });
  });

  test('the simulated van drives live on the map', async ({ page }) => {
    test.setTimeout(120_000); // the van waits for delivery windows, so a full day takes a while even sped up
    await signIn(page, 'dispo@tourwerk.de');
    await page.getByRole('link', { name: 'Dispatch', exact: true }).click();
    await page.getByRole('button', { name: 'Simulate drive' }).first().click();
    await page.getByRole('link', { name: 'Live map' }).click();
    await expect(page.getByText('Delivered').first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/pace ×\d/).first()).toBeVisible({ timeout: 10_000 }); // live ETA forecast arrived
    await page.screenshot({ path: '../docs/screens/live.png', fullPage: true });
    await expect(page.getByText('Tour completed')).toBeVisible({ timeout: 60_000 });
  });

  test('orders can be searched and created', async ({ page }) => {
    await signIn(page, 'dispo@tourwerk.de');
    await page.getByRole('link', { name: 'Orders' }).click();
    await page.getByRole('button', { name: 'New order' }).click();
    await page.getByLabel('Customer').fill('Weinkontor Jessen');
    await page.getByLabel('Street and number').fill('Mühlenkamp 31');
    await page.getByLabel('Postcode').fill('22303');
    await page.getByLabel('Weight (kg)').fill('18');
    await page.getByRole('button', { name: 'Create order' }).click();
    await page.getByLabel('Search orders').fill('Mühlenkamp 31');
    await expect(page.getByRole('cell', { name: 'Mühlenkamp 31, 22303' })).toBeVisible();
  });

  test('a recipient follows their delivery on the public tracking page', async ({ page, context }) => {
    // Some driver with a still-planned tour starts it, so parcels are out for delivery.
    let started = false;
    for (let i = 1; i <= 6 && !started; i += 1) {
      const login = await page.request.post('/api/auth/login', { data: { email: `fahrer${i}@tourwerk.de`, password: PASSWORD } });
      const headers = { authorization: `Bearer ${(await login.json()).token}` };
      const tour = await (await page.request.get('/api/tours/mine', { headers })).json();
      if (tour?.status !== 'PLANNED') continue;
      expect((await page.request.post(`/api/tours/${tour.id}/start`, { headers })).ok()).toBe(true);
      started = true;
    }
    expect(started).toBe(true);

    await signIn(page, 'dispo@tourwerk.de');
    await page.getByRole('link', { name: 'Orders' }).click();
    await page.getByRole('button', { name: 'out for delivery' }).click();
    const popup = context.waitForEvent('page');
    await page.getByRole('button', { name: 'Tracking' }).first().click();
    const track = await popup;
    await expect(track.getByText('Expected arrival (live)')).toBeVisible();
    await expect(track.getByTestId('eta')).toHaveText(/\d\d:\d\d – \d\d:\d\d/);
    await expect(track.getByRole('list', { name: 'Delivery progress' })).toBeVisible();
    await track.setViewportSize({ width: 400, height: 860 });
    await track.screenshot({ path: '../docs/screens/tracking.png', fullPage: true });
    // The link works without being signed in, but a tampered one does not.
    const fresh = await context.browser()!.newPage();
    await fresh.goto(track.url());
    await expect(fresh.getByText('Expected arrival (live)')).toBeVisible();
    await fresh.goto(track.url().replace(/\.[^.]+$/, '.tampered00000000000000'));
    await expect(fresh.getByRole('alert')).toHaveText('This tracking link is not valid.');
  });
});
