import * as THREE from 'three';
import type { Hoop, PlaneState } from '../sim/types';

const SCALE = 0.12;
const colors = { standard: 0xcbd4df, booster: 0x60e6fb, magnetic: 0xc39cff } as const;

type StarLayer = { points: THREE.Points; parallax: number; drift: number };
type DustSeed = { x: number; y: number; phase: number };

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 4294967296; };
}

function lineLoop(points: THREE.Vector3[], color: number, opacity = 0.95): THREE.LineLoop {
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity, toneMapped: false });
  return new THREE.LineLoop(geometry, material);
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
  return root;
}

function pointInOutline(x: number, y: number, outline: Hoop['outline']): boolean {
  let inside = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const a = outline[i]!; const b = outline[j]!;
    if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function createRock(hoop: Hoop): THREE.Group {
  const root = new THREE.Group();
  const color = hoop.decoy ? 0x9299a1 : hoop.type === 'standard' ? 0x6f7b89 : hoop.type === 'booster' ? 0x566f78 : 0x716b80;
  const stone = new THREE.Shape();
  hoop.outline.forEach((point, index) => {
    const x = point.x * SCALE; const y = point.y * SCALE;
    if (index === 0) stone.moveTo(x, y); else stone.lineTo(x, y);
  });
  stone.closePath();
  const bore = new THREE.Path(); bore.absarc(0, 0, hoop.radius * SCALE, 0, Math.PI * 2, true); stone.holes.push(bore);
  const thickness = hoop.thickness * SCALE;
  const frontFace = thickness / 2;
  const geometry = new THREE.ExtrudeGeometry(stone, {
    depth: thickness, bevelEnabled: true, bevelSegments: 2,
    bevelSize: 0.035, bevelThickness: 0.035, curveSegments: 40,
  });
  const position = geometry.getAttribute('position'); const vertexColors = new Float32Array(position.count * 3);
  const baseColor = new THREE.Color(color);
  for (let index = 0; index < position.count; index++) {
    const x = position.getX(index) / SCALE; const y = position.getY(index) / SCALE;
    const grain = 0.78 + (Math.sin(x * 0.71 + hoop.id * 1.37) * Math.cos(y * 0.83 - hoop.id * 0.91) + 1) * 0.115;
    const vertex = baseColor.clone().multiplyScalar(grain);
    vertexColors[index * 3] = vertex.r; vertexColors[index * 3 + 1] = vertex.g; vertexColors[index * 3 + 2] = vertex.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(vertexColors, 3));
  const rockMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0.06, flatShading: true });
  const rock = new THREE.Mesh(geometry, rockMaterial); rock.position.z = -thickness / 2; root.add(rock);

  const rockRandom = seeded(hoop.id * 0x9e3779b1 + 71);
  const craterMaterial = new THREE.MeshStandardMaterial({ color: 0x222a34, roughness: 1, metalness: 0, transparent: true, opacity: 0.72, side: THREE.DoubleSide, depthWrite: false });
  const craterCount = 4 + Math.floor(rockRandom() * 4);
  for (let crater = 0; crater < craterCount; crater++) {
    for (let attempt = 0; attempt < 12; attempt++) {
      const angle = rockRandom() * Math.PI * 2;
      const distance = hoop.radius + 2.6 + rockRandom() * 7;
      const x = Math.cos(angle) * distance; const y = Math.sin(angle) * distance;
      if (!pointInOutline(x, y, hoop.outline)) continue;
      const craterRadius = (0.45 + rockRandom() * 0.95) * SCALE;
      const pit = new THREE.Mesh(new THREE.CircleGeometry(craterRadius, 14), craterMaterial);
      pit.position.set(x * SCALE, y * SCALE, frontFace + 0.016); root.add(pit);
      break;
    }
  }

  const rimColor = colors[hoop.type];
  const stoneRim = new THREE.Mesh(new THREE.TorusGeometry(hoop.radius * SCALE, 0.033, 8, 48), new THREE.MeshStandardMaterial({ color: 0xd0d7de, metalness: 0.64, roughness: 0.31, emissive: rimColor, emissiveIntensity: hoop.decoy ? 0.08 : 0.55 }));
  stoneRim.position.z = frontFace + 0.025; root.add(stoneRim);
  if (!hoop.decoy) {
    const accentRim = new THREE.Mesh(new THREE.TorusGeometry((hoop.radius + 0.62) * SCALE, 0.018, 6, 48), new THREE.MeshBasicMaterial({ color: rimColor, transparent: true, opacity: 0.7, toneMapped: false }));
    accentRim.position.z = frontFace + 0.021; root.add(accentRim);
    if (hoop.type === 'booster') {
      const lightning = new THREE.Shape();
      lightning.moveTo(0.08, 0.36); lightning.lineTo(-0.19, 0.02); lightning.lineTo(-0.02, 0.02);
      lightning.lineTo(-0.12, -0.35); lightning.lineTo(0.2, 0.02); lightning.lineTo(0.03, 0.02); lightning.closePath();
      const bolt = new THREE.Mesh(new THREE.ShapeGeometry(lightning), new THREE.MeshBasicMaterial({ color: 0xfff2ca, side: THREE.DoubleSide, toneMapped: false }));
      bolt.position.z = frontFace + 0.033; root.add(bolt);
    } else if (hoop.type === 'magnetic' && hoop.arrow) {
      const vector = hoop.arrow === 'up' ? new THREE.Vector3(0, 1, 0)
        : hoop.arrow === 'down' ? new THREE.Vector3(0, -1, 0)
        : hoop.arrow === 'left' ? new THREE.Vector3(-1, 0, 0) : new THREE.Vector3(1, 0, 0);
      const shaft = new THREE.ArrowHelper(vector, new THREE.Vector3(0, 0, frontFace + 0.04), 0.46, 0xf3eaff, 0.18, 0.14);
      root.add(shaft);
    }
  }
  return root;
}

export class FlightWorld {
  readonly scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private ship = createStarship();
  private hoops = new Map<number, { mesh: THREE.Group; signature: string }>();
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
  render(state: PlaneState, activeHoops: Hoop[], timeSeconds: number): void {
    this.ship.position.set(state.x * SCALE, (state.y - 45) * SCALE, 0);
    this.ship.rotation.y = -Math.atan(state.headingX);
    this.ship.rotation.x = Math.atan(state.headingY);
    this.ship.rotation.z = -Math.max(-0.28, Math.min(0.28, state.headingX * 1.7));
    const thruster = this.ship.userData.thrusterGlow as THREE.Mesh;
    const thrusterMaterial = thruster.material as THREE.MeshBasicMaterial;
    const speedFactor = Math.max(0, Math.min(1, (state.speedKmh - 200) / 120));
    thrusterMaterial.opacity = 0.48 + speedFactor * 0.42;
    thruster.scale.set(1, 1, 0.7 + speedFactor * 0.8);
    this.camera.position.set(state.x * SCALE, (state.y - 45) * SCALE + 2.0, 8.5);
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
    const known = new Set<number>();
    for (const hoop of activeHoops) {
      const distance = hoop.z - state.z;
      if (distance < -2 || distance > 1050) continue;
      known.add(hoop.id);
      const signature = `${hoop.type}:${hoop.radius}:${hoop.arrow}`;
      let item = this.hoops.get(hoop.id);
      if (!item || item.signature !== signature) {
        if (item) { this.scene.remove(item.mesh); disposeObject(item.mesh); }
        item = { mesh: createRock(hoop), signature };
        this.hoops.set(hoop.id, item); this.scene.add(item.mesh);
      }
      item.mesh.position.set(hoop.x * SCALE, (hoop.y - 45) * SCALE, -distance * SCALE);
      const pulse = 1 + Math.sin(timeSeconds * 3 + hoop.id) * 0.035;
      item.mesh.scale.setScalar(pulse);
    }
    for (const [id, item] of this.hoops) if (!known.has(id)) { this.scene.remove(item.mesh); disposeObject(item.mesh); this.hoops.delete(id); }
    this.renderer.render(this.scene, this.camera);
  }
  dispose(): void {
    window.removeEventListener('resize', this.resize); disposeObject(this.scene); this.hoops.clear(); this.renderer.dispose(); this.renderer.domElement.remove();
  }
}
