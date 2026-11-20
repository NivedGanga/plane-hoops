import { expect, test } from '@playwright/test';

test('keeps live rock meshes and GPU geometry bounded while old asteroids are retired', async ({ page }) => {
  await page.goto('/');
  const stats = await page.evaluate(async () => {
    const modulePath = '/src/render/world.ts';
    const { FlightWorld } = await import(modulePath);
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:0;top:0;width:800px;height:600px;z-index:-1';
    document.body.appendChild(host);
    const world = new FlightWorld(host);
    const state = { x: 0, y: 45, z: 0, vx: 0, vy: 0, speedKmh: 320, headingX: 0, headingY: 0, tick: 0, elapsedSeconds: 0, score: 0, phase: 'playing' as const, boosterUntilTick: 0, pullUntilTick: 0, pullDirection: null };
    const rockAt = (id: number, z: number) => ({
      id, type: 'standard' as const, x: 0, y: 45, z, radius: 5.5, thickness: 4,
      outline: Array.from({ length: 24 }, (_, index) => { const angle = index * Math.PI * 2 / 24; return { x: Math.cos(angle) * 16, y: Math.sin(angle) * 16 }; }),
      decoy: false, arrow: null, cleared: false,
    });
    const batch = (offset: number, z: number) => Array.from({ length: 9 }, (_, index) => rockAt(offset + index + 1, z + 180 + index * 80));
    world.render(state, batch(0, 0), 0);
    const baseline = world.renderer.info.memory.geometries;
    let maximumGeometries = baseline;
    let maximumRocks = world.hoops.size;
    for (let step = 1; step <= 120; step++) {
      const current = { ...state, z: step * 240, tick: step * 1440, elapsedSeconds: step * 30 };
      world.render(current, batch(step * 20, current.z), step / 2);
      maximumGeometries = Math.max(maximumGeometries, world.renderer.info.memory.geometries);
      maximumRocks = Math.max(maximumRocks, world.hoops.size);
    }
    const finalRocks = world.hoops.size;
    world.dispose();
    host.remove();
    return { baseline, maximumGeometries, maximumRocks, finalRocks };
  });
  expect(stats.maximumRocks).toBe(9);
  expect(stats.finalRocks).toBe(9);
  expect(stats.maximumGeometries - stats.baseline).toBeLessThan(150);
});
