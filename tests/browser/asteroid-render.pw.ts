import { expect, test } from '@playwright/test';

test('renders a through-hole asteroid and breaks the ship apart on impact', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const modulePath = '/src/render/world.ts';
    const { FlightWorld } = await import(modulePath);
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:0;top:0;width:800px;height:600px;z-index:-1';
    document.body.appendChild(host);
    const world = new FlightWorld(host);
    const outline = Array.from({ length: 24 }, (_, index) => {
      const angle = index * Math.PI * 2 / 24;
      const radius = 15 + (index % 3) * 0.7;
      return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
    });
    const rock = { id: 777, type: 'standard' as const, x: 0, y: 45, z: 80, radius: 5.5, thickness: 8, outline, decoy: false, arrow: null, cleared: false };
    const state = { x: 0, y: 45, z: 0, vx: 0, vy: 0, speedKmh: 210, headingX: 0, headingY: 0, tick: 0, elapsedSeconds: 0, score: 0, phase: 'playing' as const, boosterUntilTick: 0, pullUntilTick: 0, pullDirection: null };
    world.render(state, [rock], 0);
    const rockGroup = world.hoops.get(777)?.mesh;
    const slab = rockGroup?.children[0] as { geometry?: { parameters?: { shapes?: { holes?: unknown[] } } } } | undefined;
    const throughHoleCount = slab?.geometry?.parameters?.shapes?.holes?.length ?? 0;
    world.explode({ x: 0.2, y: 45, z: 1 }, rock.id, state);
    const shipHidden = !world.ship.visible;
    const detachedPartCount = world.explosionPieces.length;
    world.render(state, [rock], 0.04);
    world.reset();
    const shipRestored = world.ship.visible;
    world.dispose();
    host.remove();
    return { throughHoleCount, shipHidden, detachedPartCount, shipRestored };
  });
  expect(result.throughHoleCount).toBe(1);
  expect(result.shipHidden).toBe(true);
  expect(result.detachedPartCount).toBeGreaterThan(5);
  expect(result.shipRestored).toBe(true);
});
