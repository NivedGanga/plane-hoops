import { expect, test } from '@playwright/test';

test('desktop HUD matches the reference layout without overlapping its core readouts', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    document.querySelector('#lobby-wrap')?.classList.add('hidden');
    document.querySelector('.shell')?.classList.add('game-active');
    document.querySelector('#game-hud')?.classList.remove('hidden');
    document.querySelector('#control-map')!.innerHTML = '<div class="control-map-seats"><div class="control-map-seat"><span class="control-seat-name">P1</span><span class="control-list"><span class="control-item"><kbd>W</kbd><span class="control-direction">↑ UP</span></span><span class="control-item"><kbd>D</kbd><span class="control-direction">← LEFT</span></span></span></div></div>';
    document.querySelector('#hud-gates')!.textContent = '2 / 8';
    document.querySelector('#hud-time')!.textContent = '00:18.37';
    document.querySelector('#hud-speed')!.textContent = '342';
    document.querySelector('#hud-room')!.textContent = 'ROOM CLOUD7';
    document.querySelector('#end-run-button')?.classList.remove('hidden');
  });
  for (const width of [1280, 1920, 2560]) {
    await page.setViewportSize({ width, height: 900 });
    const layout = await page.evaluate((width) => {
      const selectors = ['.gate-panel', '#control-map', '.timer-panel', '.hud-bottom-left', '.speedometer'];
      const boxes = selectors.map((selector) => {
        const rect = document.querySelector(selector)!.getBoundingClientRect();
        return { selector, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height };
      });
      const overlaps: string[] = [];
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!; const b = boxes[j]!;
        if (a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top) overlaps.push(`${a.selector}/${b.selector}`);
      }
      const gate = boxes.find((box) => box.selector === '.gate-panel')!;
      const mapping = boxes.find((box) => box.selector === '#control-map')!;
      const timer = boxes.find((box) => box.selector === '.timer-panel')!;
      const speed = boxes.find((box) => box.selector === '.speedometer')!;
      const utilities = boxes.find((box) => box.selector === '.hud-bottom-left')!;
      return {
        boxes, overlaps, text: document.querySelector('#game-hud')!.textContent ?? '',
        brandVisible: getComputedStyle(document.querySelector('.brand')!).display !== 'none',
        positions: gate.left < mapping.left && mapping.left < timer.left && Math.abs((speed.left + speed.right) / 2 - width / 2) < 2 && utilities.right < width / 2,
      };
    }, width);
    expect(layout.overlaps, `overlap at ${width}px: ${JSON.stringify(layout.boxes)}`).toEqual([]);
    expect(layout.positions).toBe(true);
    expect(layout.text).toContain('Gates:');
    expect(layout.text).toContain('2 / 8');
    expect(layout.text).toContain('00:18.37');
    expect(layout.text).toContain('W');
    expect(layout.text).toContain('↑ UP');
    expect(layout.text).toContain('ROOM CLOUD7');
    expect(layout.text).toContain('SOUND ON');
    expect(layout.text).toContain('End run');
    expect(layout.text).toContain('Speed:');
    expect(layout.text).not.toContain('Team score');
    expect(layout.text).not.toContain('Waypoints passed');
    expect(layout.brandVisible).toBe(false);
    await page.screenshot({ path: `test-results/hud-${width}.png`, fullPage: true });
  }
});
