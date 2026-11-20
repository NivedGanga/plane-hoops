import { expect, test } from '@playwright/test';

test('desktop HUD stays clear of score cards at 1280, 1920, and 2560 pixels', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    document.querySelector('#lobby-wrap')?.classList.add('hidden');
    document.querySelector('.shell')?.classList.add('game-active');
    document.querySelector('#game-hud')?.classList.remove('hidden');
    document.querySelector('#control-map')!.innerHTML = '<div class="control-map-title">CURRENT CONTROLS</div><div class="control-map-seats"><div class="control-map-seat"><span class="control-seat-name">P1 · You</span><span class="control-list"><span class="control-item"><kbd>W</kbd><span>↑ UP</span></span><span class="control-item"><kbd>D</kbd><span>← LEFT</span></span></span></div></div>';
    document.querySelector('#seat-hud')!.innerHTML = '<div class="seat-chip active"><div class="seat-chip-title">P1 · You</div><div class="seat-chip-keys"><span class="key">W</span><span class="key">D</span></div></div>';
    document.querySelector('#hud-room')!.textContent = 'ROOM CLOUD7';
    document.querySelector('#end-run-button')?.classList.remove('hidden');
  });
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
      return { boxes, overlaps, text: document.querySelector('#game-hud')!.textContent ?? '', brandVisible: getComputedStyle(document.querySelector('.brand')!).display !== 'none' };
    });
    expect(layout.overlaps, `overlap at ${width}px: ${JSON.stringify(layout.boxes)}`).toEqual([]);
    expect(layout.text).not.toMatch(/(^|\s)(L|FL)(\s|$)/);
    expect(layout.brandVisible).toBe(false);
    expect(layout.text).toContain('Holes cleared');
    expect(layout.text).toContain('W A S D · co-op keyboard · thread the holes, avoid the rocks');
    await page.screenshot({ path: `test-results/hud-${width}.png`, fullPage: true });
  }
});
