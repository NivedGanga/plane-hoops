import * as THREE from 'three';
import { CRASH_CAMERA_SHAKE_SECONDS, ROCK_OUTLINE_POINTS, SPAWN_CORRIDOR_RADIUS_M, START_Y_M } from '../../config/tuning';
import { corridorAtZ } from '../sim/collision';
import type { Hoop, PlaneState } from '../sim/types';

const SCALE = 0.12;
const colors = { standard: 0xcbd4df, booster: 0x60e6fb, magnetic: 0xc39cff } as const;

type StarLayer = { points: THREE.Points; parallax: number; drift: number };
type DustSeed = { x: number; y: number; phase: number };
type DebrisPiece = { object: THREE.Object3D; velocity: THREE.Vector3; spin: THREE.Vector3 };

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 4294967296; };
}

function disposeObject(root: THREE.Object3D): void {
  root.traverse((object) => {
    const drawable = object as THREE.Mesh;
    if (drawable.geometry) drawable.geometry.dispose();
    const material = drawable.material;
    if (Array.isArray(material)) material.forEach((item) => item.dispose());
    else material?.dispose();
  });
}

function cloneMaterials(root: THREE.Object3D): void {
  root.traverse((object) => {
    const drawable = object as THREE.Mesh;
    if (!drawable.material) return;
    drawable.material = Array.isArray(drawable.material) ? drawable.material.map((item) => item.clone()) : drawable.material.clone();
    const materials = Array.isArray(drawable.material) ? drawable.material : [drawable.material];
    for (const material of materials) { material.transparent = true; material.depthWrite = false; material.needsUpdate = true; }
  });
}

function setOpacity(root: THREE.Object3D, opacity: number): void {
  root.traverse((object) => {
    const drawable = object as THREE.Mesh;
    const materials = Array.isArray(drawable.material) ? drawable.material : drawable.material ? [drawable.material] : [];
    for (const material of materials) material.opacity = opacity;
  });
}

function createNebula(): THREE.Sprite {
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 256;
  const context = canvas.getContext('2d');
  if (context) {
    const glow = (x: number, y: number, radius: number, color: string) => {
      const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
      gradient.addColorStop(0, color); gradient.addColorStop(1, 'rgba(5,10,25,0)');
      context.fillStyle = gradient; context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    };
    glow(180, 135, 175, 'rgba(61,83,153,.19)');
    glow(285, 110, 145, 'rgba(59,31,104,.16)');
    glow(365, 150, 115, 'rgba(31,94,118,.11)');
  }
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, opacity: 0.52, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  const sprite = new THREE.Sprite(material); sprite.position.set(-14, 6, -88); sprite.scale.set(84, 42, 1); sprite.renderOrder = -2;
  return sprite;
}

function createFlashTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 128;
  const context = canvas.getContext('2d');
  if (context) {
    const glow = context.createRadialGradient(64, 64, 0, 64, 64, 64);
    glow.addColorStop(0, 'rgba(255,255,255,1)'); glow.addColorStop(0.22, 'rgba(255,255,255,.92)');
    glow.addColorStop(0.62, 'rgba(255,255,255,.24)'); glow.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = glow; context.fillRect(0, 0, 128, 128);
  }
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; return texture;
}

function createStars(count: number, seed: number, size: number, color: number, opacity: number): THREE.Points {
  const random = seeded(seed); const positions: number[] = [];
  for (let i = 0; i < count; i++) positions.push((random() - 0.5) * 220, (random() - 0.5) * 125, -random() * 125 - 14);
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({ color, size, sizeAttenuation: true, transparent: true, opacity, depthWrite: false, toneMapped: false });
  return new THREE.Points(geometry, material);
}

function createDust(count: number): { points: THREE.Points; geometry: THREE.BufferGeometry; seeds: DustSeed[] } {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(count * 3), 3));
  const random = seeded(0x51ace); const seeds = Array.from({ length: count }, () => ({ x: (random() - 0.5) * 24, y: (random() - 0.5) * 14, phase: random() * 120 }));
  const material = new THREE.PointsMaterial({ color: 0xa4ccf3, size: 0.055, sizeAttenuation: true, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  const points = new THREE.Points(geometry, material); points.frustumCulled = false;
  return { points, geometry, seeds };
}

function createStarship(): THREE.Group {
  const root = new THREE.Group();
  const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0xb9c8d6, metalness: 0.72, roughness: 0.3, emissive: 0x182336, emissiveIntensity: 0.48 });
  const accent = new THREE.MeshStandardMaterial({ color: 0x58e5da, metalness: 0.55, roughness: 0.25, emissive: 0x087c83, emissiveIntensity: 0.7 });
  const fuselage = new THREE.Mesh(new THREE.CapsuleGeometry(0.23, 1.18, 4, 12), bodyMaterial);
  fuselage.rotation.x = Math.PI / 2; fuselage.position.z = -0.05; root.add(fuselage);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.21, 0.48, 12), bodyMaterial);
  nose.rotation.x = -Math.PI / 2; nose.position.z = -0.88; root.add(nose);
  const wingShape = new THREE.Shape();
  wingShape.moveTo(-0.28, -0.48); wingShape.lineTo(-2.42, 0.42); wingShape.lineTo(-2.67, 0.85);
  wingShape.lineTo(-0.45, 0.42); wingShape.lineTo(0, 0.58); wingShape.lineTo(0.45, 0.42);
  wingShape.lineTo(2.67, 0.85); wingShape.lineTo(2.42, 0.42); wingShape.lineTo(0.28, -0.48); wingShape.closePath();
  const wings = new THREE.Mesh(new THREE.ExtrudeGeometry(wingShape, { depth: 0.11, bevelEnabled: true, bevelThickness: 0.035, bevelSize: 0.04, bevelSegments: 1 }), accent);
  wings.rotation.x = Math.PI / 2; wings.position.y = 0.055; root.add(wings);
  const tailFin = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.33, 0.48), bodyMaterial);
  tailFin.position.set(0, 0.19, 0.51); root.add(tailFin);
  for (const side of [-1, 1]) {
    const engine = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.54, 12), bodyMaterial);
    engine.rotation.x = Math.PI / 2; engine.position.set(side * 0.32, -0.02, 0.56); root.add(engine);
    const nozzle = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.035, 8, 14), accent);
    nozzle.position.set(side * 0.32, -0.02, 0.84); root.add(nozzle);
    const exhaust = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.74, 10), new THREE.MeshBasicMaterial({ color: 0x54e8ff, transparent: true, opacity: 0.66, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    exhaust.rotation.x = Math.PI / 2; exhaust.position.set(side * 0.32, -0.02, 1.22); root.add(exhaust);
    if (side === 1) root.userData.thrusterGlow = exhaust;
  }
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), new THREE.MeshPhysicalMaterial({ color: 0x84d8ff, metalness: 0.68, roughness: 0.13, clearcoat: 1, emissive: 0x16395a, emissiveIntensity: 0.55 }));
  canopy.scale.set(0.78, 0.55, 1.55); canopy.position.set(0, 0.19, -0.26); root.add(canopy);
  const lamp = new THREE.PointLight(0x63e8ff, 2.0, 5); lamp.position.set(0, 0.08, -0.9); root.add(lamp);
  root.scale.setScalar(SCALE);
  return root;
}

function createCorridorSegment(from: Hoop, to: Hoop): THREE.Group {
  const root = new THREE.Group();
  const radialCount = ROCK_OUTLINE_POINTS;
  const longitudinalSteps = Math.max(2, Math.ceil((to.z - from.z) / 12));
  const verticesPerStation = radialCount * 2;
  const positions: number[] = []; const vertexColors: number[] = []; const indices: number[] = [];
  const baseColor = new THREE.Color(0x536d85); const random = seeded((from.id * 0x9e3779b1 + to.id * 0x85ebca6b) >>> 0);

  for (let step = 0; step <= longitudinalSteps; step++) {
    const t = step / longitudinalSteps;
    const centerX = from.x + (to.x - from.x) * t;
    const centerY = from.y + (to.y - from.y) * t;
    const radius = from.radius + (to.radius - from.radius) * t;
    const depth = -(to.z - from.z) * t * SCALE;
    for (let index = 0; index < radialCount; index++) {
      const angle = index * Math.PI * 2 / radialCount;
      const innerX = Math.cos(angle) * radius; const innerY = Math.sin(angle) * radius;
      const outerA = from.outline[index]!; const outerB = to.outline[index]!;
      const outerX = outerA.x + (outerB.x - outerA.x) * t; const outerY = outerA.y + (outerB.y - outerA.y) * t;
      for (const [x, y] of [[innerX, innerY], [outerX, outerY]]) {
        positions.push(((centerX - from.x) + x) * SCALE, ((centerY - from.y) + y) * SCALE, depth);
        const grain = 0.66 + random() * 0.62;
        const color = baseColor.clone().multiplyScalar(grain);
        vertexColors.push(color.r, color.g, color.b);
      }
    }
  }

  for (let step = 0; step < longitudinalSteps; step++) {
    for (let index = 0; index < radialCount; index++) {
      const next = (index + 1) % radialCount;
      const innerA = step * verticesPerStation + index * 2;
      const innerB = (step + 1) * verticesPerStation + index * 2;
      const innerNextA = step * verticesPerStation + next * 2;
      const innerNextB = (step + 1) * verticesPerStation + next * 2;
      const outerA = innerA + 1; const outerB = innerB + 1;
      const outerNextA = innerNextA + 1; const outerNextB = innerNextB + 1;
      indices.push(innerA, innerB, innerNextB, innerA, innerNextB, innerNextA);
      indices.push(outerA, outerNextB, outerB, outerA, outerNextA, outerNextB);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(vertexColors, 3));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  const rockMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0.03, flatShading: true, side: THREE.DoubleSide });
  root.add(new THREE.Mesh(geometry, rockMaterial));
  // A deterministic halo of faceted boulders sits just beyond the passage lip,
  // giving the continuous wall a readable asteroid-field silhouette.
  const boulderRandom = seeded((from.id * 0x27d4eb2d + to.id * 0x165667b1 + 0xb01d) >>> 0);
  const boulderPalette = [0x87726f, 0x665d78, 0x7a6879, 0x73645d, 0x526273];
  const boulderCount = Math.max(16, Math.ceil((to.z - from.z) / 12) * 2);
  const boulders = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(1, 0),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.98, flatShading: true }),
    boulderCount,
  );
  const position = new THREE.Vector3(); const rotation = new THREE.Quaternion(); const size = new THREE.Vector3();
  const transform = new THREE.Matrix4();
  for (let index = 0; index < boulderCount; index++) {
    const t = boulderRandom();
    const angle = boulderRandom() * Math.PI * 2;
    const radius = from.radius + (to.radius - from.radius) * t;
    const centerX = from.x + (to.x - from.x) * t;
    const centerY = from.y + (to.y - from.y) * t;
    const radiusMeters = 3.5 + boulderRandom() * 4.5;
    const radialDistance = radius + radiusMeters * 1.35 + 3.5 + boulderRandom() * 1.5;
    position.set(((centerX - from.x) + Math.cos(angle) * radialDistance) * SCALE,
      ((centerY - from.y) + Math.sin(angle) * radialDistance) * SCALE,
      -(to.z - from.z) * t * SCALE);
    rotation.setFromEuler(new THREE.Euler(boulderRandom() * Math.PI, boulderRandom() * Math.PI, boulderRandom() * Math.PI));
    size.set(radiusMeters * SCALE * (0.78 + boulderRandom() * 0.55), radiusMeters * SCALE * (0.72 + boulderRandom() * 0.6), radiusMeters * SCALE * (0.78 + boulderRandom() * 0.55));
    transform.compose(position, rotation, size);
    boulders.setMatrixAt(index, transform);
    const color = new THREE.Color(boulderPalette[Math.floor(boulderRandom() * boulderPalette.length)]!).multiplyScalar(0.86 + boulderRandom() * 0.28);
    boulders.setColorAt(index, color);
  }
  boulders.computeBoundingSphere();
  root.add(boulders);
  return root;
}

function createApproachCue(): THREE.Group {
  const cue = new THREE.Group();
  const material = new THREE.MeshBasicMaterial({ color: 0x39f4ff, transparent: true, opacity: 0.92, toneMapped: false });
  const shape = new THREE.Shape();
  shape.moveTo(-0.42, 0.22); shape.lineTo(-0.29, 0.36); shape.lineTo(0, 0.06);
  shape.lineTo(0.29, 0.36); shape.lineTo(0.42, 0.22); shape.lineTo(0, -0.2); shape.closePath();
  const marker = new THREE.Mesh(new THREE.ShapeGeometry(shape), material);
  marker.position.z = -0.025;
  cue.add(marker);
  cue.add(new THREE.PointLight(0x22eaff, 0.55, 2.8));
  return cue;
}

function createWaypointMarker(hoop: Hoop): THREE.Group {
  const root = new THREE.Group();
  const color = colors[hoop.type];
  const marker = new THREE.Mesh(new THREE.OctahedronGeometry(0.42, 0), new THREE.MeshBasicMaterial({ color, toneMapped: false }));
  root.add(marker);
  const glow = new THREE.PointLight(color, 1.8, 4); root.add(glow);
  const chevronGeometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-0.62, -0.35, 0), new THREE.Vector3(0, 0, -0.08),
    new THREE.Vector3(0.62, -0.35, 0),
  ]);
  root.add(new THREE.Line(chevronGeometry, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.74, toneMapped: false })));
  if (hoop.type === 'magnetic' && hoop.arrow) {
    const vector = hoop.arrow === 'up' ? new THREE.Vector3(0, 1, 0)
      : hoop.arrow === 'down' ? new THREE.Vector3(0, -1, 0)
        : hoop.arrow === 'left' ? new THREE.Vector3(-1, 0, 0) : new THREE.Vector3(1, 0, 0);
    root.add(new THREE.ArrowHelper(vector, new THREE.Vector3(0, 0.48, 0), 0.52, color, 0.16, 0.13));
  }
  return root;
}

export class FlightWorld {
  readonly scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private ship = createStarship();
  private explosionPieces: DebrisPiece[] = [];
  private explosionParticles?: THREE.Points;
  private explosionGeometry?: THREE.BufferGeometry;
  private explosionFlash?: THREE.Sprite;
  private explosionFlashTexture?: THREE.CanvasTexture;
  private shockwave?: THREE.Mesh;
  private particlePositions: THREE.Vector3[] = [];
  private particleVelocities: THREE.Vector3[] = [];
  private explosionStarted = false;
  private explosionElapsed = 0;
  private explosionSeed = 0;
  private lastRenderSeconds?: number;
  private corridorSegments = new Map<string, { mesh: THREE.Group; signature: string }>();
  private waypointMarkers = new Map<number, { mesh: THREE.Group; signature: string }>();
  private approachCues = new Map<number, THREE.Group>();
  private starLayers: StarLayer[] = [];
  private dust: THREE.Points;
  private dustGeometry: THREE.BufferGeometry;
  private dustSeeds: DustSeed[];
  constructor(private host: HTMLElement) {
    const width = host.clientWidth || window.innerWidth;
    const height = host.clientHeight || window.innerHeight;
    this.scene.background = new THREE.Color(0x03050b);
    this.camera = new THREE.PerspectiveCamera(52, width / height, 0.1, 260);
    this.camera.position.set(0, 2.0, 8.5); this.camera.lookAt(0, 0, -9);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); this.renderer.setSize(width, height);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.14;
    this.renderer.domElement.className = 'flight-canvas'; host.appendChild(this.renderer.domElement);
    this.scene.add(new THREE.HemisphereLight(0x7184b6, 0x070a12, 0.16));
    const key = new THREE.DirectionalLight(0xfff1da, 2.7); key.position.set(-4, 10, 8); this.scene.add(key);
    const rim = new THREE.PointLight(0x7188ff, 12, 38); rim.position.set(3, 2, -8); this.scene.add(rim);
    this.scene.add(createNebula());
    this.starLayers = [
      { points: createStars(560, 618033, 0.085, 0xc7dcff, 0.72), parallax: 0.1, drift: 0.05 },
      { points: createStars(360, 715043, 0.12, 0x9dbaff, 0.62), parallax: 0.28, drift: 0.11 },
      { points: createStars(230, 923417, 0.17, 0xe3edff, 0.78), parallax: 0.62, drift: 0.21 },
    ];
    for (const layer of this.starLayers) this.scene.add(layer.points);
    const dust = createDust(320); this.dust = dust.points; this.dustGeometry = dust.geometry; this.dustSeeds = dust.seeds; this.scene.add(this.dust);
    this.scene.add(this.ship);
    window.addEventListener('resize', this.resize);
  }
  private resize = (): void => {
    const width = this.host.clientWidth || window.innerWidth; const height = this.host.clientHeight || window.innerHeight;
    this.camera.aspect = width / height; this.camera.updateProjectionMatrix(); this.renderer.setSize(width, height);
  };
  private clearExplosion(): void {
    for (const piece of this.explosionPieces) { this.scene.remove(piece.object); disposeObject(piece.object); }
    this.explosionPieces = [];
    if (this.explosionParticles) { this.scene.remove(this.explosionParticles); disposeObject(this.explosionParticles); }
    if (this.explosionFlash) { this.scene.remove(this.explosionFlash); disposeObject(this.explosionFlash); }
    this.explosionFlashTexture?.dispose();
    if (this.shockwave) { this.scene.remove(this.shockwave); disposeObject(this.shockwave); }
    this.explosionParticles = undefined; this.explosionGeometry = undefined;
    this.explosionFlash = undefined; this.explosionFlashTexture = undefined; this.shockwave = undefined;
    this.particlePositions = []; this.particleVelocities = [];
  }
  reset(): void {
    this.clearExplosion(); this.scene.remove(this.ship); disposeObject(this.ship);
    this.ship = createStarship(); this.scene.add(this.ship);
    this.explosionStarted = false; this.explosionElapsed = 0; this.lastRenderSeconds = undefined;
  }
  explode(impactPoint: { x: number; y: number; z: number }, rockId: number, state: PlaneState): void {
    if (this.explosionStarted) return;
    this.explosionStarted = true; this.explosionElapsed = 0;
    this.ship.position.set(state.x * SCALE, (state.y - 45) * SCALE, 0);
    this.ship.rotation.y = -Math.atan(state.headingX); this.ship.rotation.x = Math.atan(state.headingY);
    this.ship.rotation.z = -Math.max(-0.28, Math.min(0.28, state.headingX * 1.7));
    const origin = new THREE.Vector3(impactPoint.x * SCALE, (impactPoint.y - 45) * SCALE, -(impactPoint.z - state.z) * SCALE);
    this.explosionSeed = (rockId * 0x9e3779b1 + state.tick * 0x85ebca6b) >>> 0;
    const random = seeded(this.explosionSeed);
    for (const [index, part] of [...this.ship.children].entries()) {
      this.scene.attach(part); cloneMaterials(part);
      const direction = part.position.clone().sub(origin);
      if (direction.lengthSq() < 0.0001) direction.set(random() - 0.5, random() - 0.25, random() - 0.5);
      direction.normalize().multiplyScalar(0.55 + random() * 1.05);
      direction.x += (random() - 0.5) * 0.32; direction.y += 0.12 + random() * 0.55; direction.z += (random() - 0.5) * 0.28;
      this.explosionPieces.push({ object: part, velocity: direction, spin: new THREE.Vector3(random() - 0.5, random() - 0.5, random() - 0.5).multiplyScalar(4 + index % 3) });
    }
    this.ship.visible = false;
    const flash = new THREE.PointLight(0xffffff, 12, 10); flash.position.copy(origin); this.scene.add(flash);
    this.explosionPieces.push({ object: flash, velocity: new THREE.Vector3(), spin: new THREE.Vector3() });
    this.explosionFlashTexture = createFlashTexture();
    this.explosionFlash = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.explosionFlashTexture, color: 0xffffff, transparent: true, opacity: 0.98, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    this.explosionFlash.position.copy(origin); this.explosionFlash.scale.set(0.42, 0.42, 1); this.scene.add(this.explosionFlash);
    this.shockwave = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.025, 8, 48), new THREE.MeshBasicMaterial({ color: 0xeaf8ff, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false }));
    this.shockwave.position.copy(origin); this.scene.add(this.shockwave);

    const count = 96; const values = new Float32Array(count * 3);
    this.particlePositions = []; this.particleVelocities = [];
    for (let index = 0; index < count; index++) {
      const direction = new THREE.Vector3(random() * 2 - 1, random() * 2 - 1, random() * 2 - 1).normalize();
      const start = origin.clone().addScaledVector(direction, 0.025);
      values[index * 3] = start.x; values[index * 3 + 1] = start.y; values[index * 3 + 2] = start.z;
      this.particlePositions.push(start);
      this.particleVelocities.push(direction.multiplyScalar(0.55 + random() * 2.1));
    }
    this.explosionGeometry = new THREE.BufferGeometry();
    this.explosionGeometry.setAttribute('position', new THREE.BufferAttribute(values, 3));
    this.explosionParticles = new THREE.Points(this.explosionGeometry, new THREE.PointsMaterial({ color: 0xffbd86, size: 0.075, sizeAttenuation: true, transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    this.scene.add(this.explosionParticles);
  }
  private updateExplosion(timeSeconds: number): void {
    const dt = Math.max(0, Math.min(0.05, timeSeconds - (this.lastRenderSeconds ?? timeSeconds)));
    this.lastRenderSeconds = timeSeconds;
    if (!this.explosionStarted) return;
    this.explosionElapsed += dt;
    const fade = Math.max(0, 1 - this.explosionElapsed / 1.35);
    for (const piece of this.explosionPieces) {
      piece.velocity.y -= 0.18 * dt;
      piece.object.position.addScaledVector(piece.velocity, dt);
      piece.object.rotation.x += piece.spin.x * dt; piece.object.rotation.y += piece.spin.y * dt; piece.object.rotation.z += piece.spin.z * dt;
      setOpacity(piece.object, fade);
      if (piece.object instanceof THREE.PointLight) piece.object.intensity = 12 * Math.max(0, 1 - this.explosionElapsed / 0.24);
    }
    if (this.explosionFlash) {
      const flashProgress = Math.min(1, this.explosionElapsed / 0.22);
      this.explosionFlash.material.opacity = Math.max(0, 0.98 * (1 - flashProgress));
      this.explosionFlash.scale.setScalar(0.42 + flashProgress * 1.45);
    }
    if (this.shockwave) {
      this.shockwave.scale.setScalar(1 + this.explosionElapsed * 5.5);
      (this.shockwave.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.95 * (1 - this.explosionElapsed / 0.9));
    }
    const attribute = this.explosionGeometry?.getAttribute('position') as THREE.BufferAttribute | undefined;
    if (attribute) {
      for (let index = 0; index < this.particlePositions.length; index++) {
        const velocity = this.particleVelocities[index]!; velocity.y -= 0.22 * dt; velocity.multiplyScalar(Math.exp(-0.12 * dt));
        const position = this.particlePositions[index]!.addScaledVector(velocity, dt);
        attribute.setXYZ(index, position.x, position.y, position.z);
      }
      attribute.needsUpdate = true;
      const material = this.explosionParticles?.material as THREE.PointsMaterial | undefined;
      if (material) material.opacity = fade;
    }
    if (this.explosionElapsed >= 1.35) this.clearExplosion();
  }
  render(state: PlaneState, activeHoops: Hoop[], timeSeconds: number): void {
    this.updateExplosion(timeSeconds);
    if (!this.explosionStarted) {
      this.ship.position.set(state.x * SCALE, (state.y - 45) * SCALE, 0);
      this.ship.rotation.y = -Math.atan(state.headingX);
      this.ship.rotation.x = Math.atan(state.headingY);
      this.ship.rotation.z = -Math.max(-0.28, Math.min(0.28, state.headingX * 1.7));
      const thruster = this.ship.userData.thrusterGlow as THREE.Mesh;
      const thrusterMaterial = thruster.material as THREE.MeshBasicMaterial;
      const speedFactor = Math.max(0, Math.min(1, (state.speedKmh - 200) / 120));
      thrusterMaterial.opacity = 0.48 + speedFactor * 0.42;
      thruster.scale.set(1, 1, 0.7 + speedFactor * 0.8);
    }
    this.camera.position.set(state.x * SCALE, (state.y - 45) * SCALE + 2.0, 8.5);
    if (this.explosionStarted && this.explosionElapsed < CRASH_CAMERA_SHAKE_SECONDS) {
      const envelope = 1 - this.explosionElapsed / CRASH_CAMERA_SHAKE_SECONDS;
      const phase = this.explosionElapsed * 75;
      this.camera.position.x += Math.sin(phase + (this.explosionSeed & 255)) * 0.16 * envelope;
      this.camera.position.y += Math.sin(phase * 1.31 + (this.explosionSeed >>> 8 & 255)) * 0.11 * envelope;
    }
    this.camera.lookAt(state.x * SCALE, (state.y - 45) * SCALE, -9);
    for (const layer of this.starLayers) {
      layer.points.position.set(state.x * SCALE * layer.parallax, (state.y - 45) * SCALE * layer.parallax, (state.z * SCALE * layer.drift) % 28);
    }
    const density = Math.round(105 + 180 * Math.max(0, Math.min(1, (state.speedKmh - 200) / 120)));
    this.dustGeometry.setDrawRange(0, density);
    const positions = this.dustGeometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < density; i++) {
      const seed = this.dustSeeds[i]!;
      const depth = (state.z * 0.72 + seed.phase) % 96;
      positions.setXYZ(i, state.x * SCALE * 0.62 + seed.x, (state.y - 45) * SCALE * 0.62 + seed.y, -depth * SCALE - 0.5);
    }
    positions.needsUpdate = true;
    this.dust.rotation.z = Math.sin(timeSeconds * 0.12) * 0.012;
    const route = activeHoops.filter((hoop) => !hoop.decoy).slice().sort((a, b) => a.z - b.z || a.id - b.id);
    if (route[0]?.id === 1 && state.z < route[0].z) {
      route.unshift({
        id: 0, type: 'standard', x: 0, y: START_Y_M, z: 0, radius: SPAWN_CORRIDOR_RADIUS_M,
        outline: route[0].outline, decoy: false, arrow: null, cleared: true,
      });
    }

    const knownSegments = new Set<string>();
    for (let index = 0; index < route.length - 1; index++) {
      const from = route[index]!; const to = route[index + 1]!;
      if (to.z - state.z < -2 || from.z - state.z > 1050) continue;
      const key = `${from.id}:${to.id}`;
      const signature = `${from.radius}:${to.radius}:${from.outline.length}:${to.outline.length}`;
      let item = this.corridorSegments.get(key);
      if (!item || item.signature !== signature) {
        if (item) { this.scene.remove(item.mesh); disposeObject(item.mesh); }
        item = { mesh: createCorridorSegment(from, to), signature };
        this.corridorSegments.set(key, item); this.scene.add(item.mesh);
      }
      item.mesh.position.set(from.x * SCALE, (from.y - 45) * SCALE, -(from.z - state.z) * SCALE);
      knownSegments.add(key);
    }
    for (const [key, item] of this.corridorSegments) {
      if (!knownSegments.has(key)) { this.scene.remove(item.mesh); disposeObject(item.mesh); this.corridorSegments.delete(key); }
    }

    const knownCues = new Set<number>();
    const cueSpacing = 18;
    const firstCue = Math.ceil(Math.max(0, state.z + 8) / cueSpacing);
    const lastCue = Math.floor((state.z + 120) / cueSpacing);
    for (let station = firstCue; station <= lastCue; station++) {
      const z = station * cueSpacing;
      const sample = corridorAtZ(route, z);
      if (!sample) continue;
      knownCues.add(station);
      let cue = this.approachCues.get(station);
      if (!cue) { cue = createApproachCue(); this.approachCues.set(station, cue); this.scene.add(cue); }
      cue.position.set(sample.x * SCALE, (sample.y - 45) * SCALE, -(z - state.z) * SCALE);
    }
    for (const [station, cue] of this.approachCues) {
      if (!knownCues.has(station)) { this.scene.remove(cue); disposeObject(cue); this.approachCues.delete(station); }
    }

    const knownMarkers = new Set<number>();
    for (const hoop of route) {
      const distance = hoop.z - state.z;
      if (hoop.id === 0 || hoop.cleared || distance < -2 || distance > 1050) continue;
      knownMarkers.add(hoop.id);
      const signature = `${hoop.type}:${hoop.arrow}`;
      let item = this.waypointMarkers.get(hoop.id);
      if (!item || item.signature !== signature) {
        if (item) { this.scene.remove(item.mesh); disposeObject(item.mesh); }
        item = { mesh: createWaypointMarker(hoop), signature };
        this.waypointMarkers.set(hoop.id, item); this.scene.add(item.mesh);
      }
      item.mesh.position.set(hoop.x * SCALE, (hoop.y - 45) * SCALE, -distance * SCALE);
    }
    for (const [id, item] of this.waypointMarkers) {
      if (!knownMarkers.has(id)) { this.scene.remove(item.mesh); disposeObject(item.mesh); this.waypointMarkers.delete(id); }
    }
    this.renderer.render(this.scene, this.camera);
  }
  dispose(): void {
    window.removeEventListener('resize', this.resize); disposeObject(this.scene);
    this.corridorSegments.clear(); this.waypointMarkers.clear(); this.approachCues.clear(); this.renderer.dispose(); this.renderer.domElement.remove();
  }
}
