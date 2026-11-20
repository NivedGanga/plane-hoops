import { expect, test } from '@playwright/test';

test('desktop HUD stays clear of score cards at 1280, 1920, and 2560 pixels', async ({ page }) => {
  await page.goto('/');
  await page.locator('#game-hud').evaluate((node) => node.classList.remove('hidden'));
  for (const width of [1280, 1920, 2560]) {
    await page.setViewportSize({ width, height: 900 });
    const layout = await page.evaluate(() => {
      const selectors = ['.stats', '#control-map', '.hud-tools'];
      const boxes = selectors.map((selector) => {
        const rect = document.querySelector(selector)!.getBoundingClientRect();
        return { selector, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
      });
      const overlaps: string[] = [];
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!; const b = boxes[j]!;
        if (a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top) overlaps.push(`${a.selector}/${b.selector}`);
      }
      return { boxes, overlaps, text: document.querySelector('#game-hud')!.textContent ?? '' };
    });
    expect(layout.overlaps, `overlap at ${width}px: ${JSON.stringify(layout.boxes)}`).toEqual([]);
    expect(layout.text).not.toMatch(/(^|\s)(L|FL)(\s|$)/);
    expect(layout.text).toContain('Holes cleared');
    expect(layout.text).toContain('W A S D · co-op keyboard · thread the holes, avoid the rocks');
  }
});
