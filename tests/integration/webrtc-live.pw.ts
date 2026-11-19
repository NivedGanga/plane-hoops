import { expect, test } from '@playwright/test';

const enabled = Boolean(process.env.VITE_SUPABASE_URL && process.env.VITE_SUPABASE_ANON_KEY);

test.skip(!enabled, 'Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to run against a live Supabase project.');

test('two browser clients join through Supabase signaling and establish WebRTC data channel', async ({ browser }) => {
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  // The signaling and game remain live, but a smoke test must not publish a dummy score.
  await hostContext.route('**/rest/v1/leaderboard*', async route => {
    if (route.request().method() === 'POST') await route.fulfill({ status: 201, body: '' });
    else await route.continue();
  });
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  const hostErrors: string[] = [];
  const guestErrors: string[] = [];
  host.on('pageerror', error => hostErrors.push(error.message));
  guest.on('pageerror', error => guestErrors.push(error.message));

  try {
    await host.goto('/');
    await host.locator('#room-name-input').fill('Live WebRTC smoke');
    await host.locator('#host-name-input').fill('Host Smoke');
    await host.getByRole('button', { name: 'Create flight room' }).click();
    await host.waitForFunction(() => Boolean(document.querySelector('.room-code')) || !document.querySelector('#error-message')?.classList.contains('hidden'), undefined, { timeout: 30000 });
    const hostError = await host.locator('#error-message').innerText();
    expect(hostError, `Host signaling error: ${hostError}`).toBe('');
    await expect(host.locator('.room-code')).toHaveText(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/i);
    const roomCode = (await host.locator('.room-code').innerText()).trim();

    await guest.goto('/');
    await guest.getByRole('button', { name: 'Join a crew' }).click();
    await guest.locator('#join-name-input').fill('Guest Smoke');
    await guest.locator('#room-code-input').fill(roomCode);
    await guest.getByRole('button', { name: 'Join the flight' }).click();

    await expect(host.locator('#room-view')).toContainText('2 / 2 seats ready', { timeout: 60000 });
    await expect(host.locator('#room-view')).toContainText('Guest Smoke');
    await expect(host.locator('#room-view #lobby-start')).toBeEnabled();
    await expect(guest.locator('#room-view')).toContainText('Seat 2', { timeout: 60000 });
    await expect(guest.locator('#room-view')).toContainText('Guest Smoke');
    await host.locator('#lobby-start').click();
    await expect(host.locator('#end-run-button')).toBeVisible();
    await expect(guest.locator('#game-hud')).toBeVisible();
    await host.locator('#end-run-button').click();
    await expect(host.locator('#result-overlay')).toBeVisible();
    await expect(guest.locator('#result-overlay')).toBeVisible();
    await expect(guest.locator('#result-score')).toHaveText(await host.locator('#result-score').innerText());
    await host.locator('#return-lobby-button').click();
    await expect(host.locator('#room-view')).toBeVisible();
    const removal = host.waitForResponse(response => response.url().includes('/rest/v1/rooms') && response.request().method() === 'DELETE' && response.ok(), { timeout: 10000 });
    await host.locator('#lobby-leave').click();
    await removal;
    expect(hostErrors).toEqual([]);
    expect(guestErrors).toEqual([]);
  } finally {
    await hostContext.close();
    await guestContext.close();
  }
});
