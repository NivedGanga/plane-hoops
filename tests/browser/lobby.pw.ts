import { expect, test } from '@playwright/test';

test('lobby validates names and renders only 2 or 4 seats', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /One plane/ })).toBeVisible();
  await page.getByRole('button', { name: 'Create flight room' }).click();
  await expect(page.locator('#error-message')).toContainText('Room name');
  await expect(page.locator('[data-count]')).toHaveCount(2);
  await page.getByRole('button', { name: /4 pilots/ }).click();
  await expect(page.locator('#local-seats option')).toHaveCount(4);
  await page.getByRole('button', { name: /2 pilots/ }).click();
  await expect(page.locator('#local-seats option')).toHaveCount(2);
});

test('a new visit prefills values saved in the same browser', async ({ browser }) => {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    localStorage.setItem('planeHoops.lastRoomName', 'Sky Club');
    localStorage.setItem('planeHoops.displayName', 'Pilot');
  });
  const page = await context.newPage();
  await page.goto('/');
  await expect(page.locator('#room-name-input')).toHaveValue('Sky Club');
  await expect(page.locator('#host-name-input')).toHaveValue('Pilot');
  await context.close();
});
