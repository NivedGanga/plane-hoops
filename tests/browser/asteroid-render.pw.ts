import { expect, test } from '@playwright/test';

test('renders a continuous winding asteroid corridor and keeps impact breakup behavior', async ({ page }) => {
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
      const radius = 120 + (index % 3) * 3;
      return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
    });
    const route = [
      { id: 1, type: 'standard' as const, x: 0, y: 45, z: 80, radius: 7.5, outline, decoy: false, arrow: null, cleared: false },
      { id: 2, type: 'booster' as const, x: 12, y: 51, z: 180, radius: 7, outline, decoy: false, arrow: null, cleared: false },
      { id: 3, type: 'magnetic' as const, x: 18, y: 58, z: 280, radius: 6.5, outline, decoy: false, arrow: 'up' as const, cleared: false },
    ];
    const state = { x: 0, y: 45, z: 0, vx: 0, vy: 0, speedKmh: 210, headingX: 0, headingY: 0, tick: 0, elapsedSeconds: 0, score: 0, phase: 'playing' as const, boosterUntilTick: 0, pullUntilTick: 0, pullDirection: null };
    world.render(state, route, 0);
    const segment = world.corridorSegments.get('0:1')?.mesh.children[0] as { geometry?: { type?: string; attributes?: { position?: { count: number } }; index?: { count: number } } } | undefined;
    const wallVertexCount = segment?.geometry?.attributes?.position?.count ?? 0;
    const wallTriangleIndexCount = segment?.geometry?.index?.count ?? 0;
    const corridorSegmentCount = world.corridorSegments.size;
    const waypointMarkerCount = world.waypointMarkers.size;
    world.explode({ x: 0.2, y: 45, z: 1 }, route[0]!.id, state);
    const shipHidden = !world.ship.visible;
    const detachedPartCount = world.explosionPieces.length;
    const hasWhiteFlash = Boolean(world.explosionFlash);
    const initialShockwaveScale = world.shockwave?.scale.x ?? 0;
    world.render(state, route, 0.04);
    const cameraShake = Math.hypot(world.camera.position.x, world.camera.position.y - 2);
    const expandedShockwaveScale = world.shockwave?.scale.x ?? 0;
    world.reset();
    const shipRestored = world.ship.visible;
    world.dispose();
    host.remove();
    return { wallVertexCount, wallTriangleIndexCount, corridorSegmentCount, waypointMarkerCount, shipHidden, detachedPartCount, shipRestored, hasWhiteFlash, initialShockwaveScale, expandedShockwaveScale, cameraShake };
  });
  expect(result.corridorSegmentCount).toBe(3);
  expect(result.waypointMarkerCount).toBe(3);
  expect(result.wallVertexCount).toBeGreaterThan(300);
  expect(result.wallTriangleIndexCount).toBeGreaterThan(1000);
  expect(result.shipHidden).toBe(true);
  expect(result.detachedPartCount).toBeGreaterThan(5);
  expect(result.hasWhiteFlash).toBe(true);
  expect(result.expandedShockwaveScale).toBeGreaterThan(result.initialShockwaveScale);
  expect(result.cameraShake).toBeGreaterThan(0.001);
  expect(result.shipRestored).toBe(true);
});
