import * as THREE from 'three';
import type { Hoop, PlaneState } from '../sim/types';

const SCALE = 0.12;
const colors = { standard: 0x69f0d2, booster: 0xffc76a, magnetic: 0xc39cff } as const;

function lineLoop(points: THREE.Vector3[], color: number, opacity = 0.95): THREE.LineLoop {
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity, toneMapped: false });
  return new THREE.LineLoop(geometry, material);
}
function createPlane(): THREE.Group {
  const root = new THREE.Group();
  const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0xf5fbff, metalness: 0.28, roughness: 0.3, emissive: 0x1a3445, emissiveIntensity: 0.5 });
  const accent = new THREE.MeshStandardMaterial({ color: 0x61e8d1, metalness: 0.25, roughness: 0.28, emissive: 0x12a994, emissiveIntensity: 0.55 });
  const fuselage = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 1.08, 4, 10), bodyMaterial);
  fuselage.rotation.x = Math.PI / 2; fuselage.position.z = -0.05; root.add(fuselage);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.21, 0.47, 10), accent);
  nose.rotation.x = -Math.PI / 2; nose.position.z = -0.88; root.add(nose);
  const wing = new THREE.Mesh(new THREE.BoxGeometry(2.05, 0.095, 0.43), accent);
  wing.position.z = 0.03; root.add(wing);
  const tailWing = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.08, 0.25), bodyMaterial);
  tailWing.position.set(0, 0.08, 0.65); root.add(tailWing);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.3, 0.45), accent);
  fin.position.set(0, 0.17, 0.53); root.add(fin);
  const cockpit = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 10), new THREE.MeshStandardMaterial({ color: 0x87c6ff, metalness: 0.6, roughness: 0.15, emissive: 0x164a75, emissiveIntensity: 0.8 }));
  cockpit.scale.set(0.72, 0.8, 1.35); cockpit.position.set(0, 0.19, -0.25); root.add(cockpit);
  const lamp = new THREE.PointLight(0x63e8d2, 2.0, 5); lamp.position.set(0, 0.25, -0.8); root.add(lamp);
  return root;
}

function createHoop(hoop: Hoop): THREE.Group {
  const root = new THREE.Group();
  const color = colors[hoop.type];
  const radius = hoop.radius * SCALE;
  if (hoop.type === 'standard') {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.075, 10, 40), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.2, roughness: 0.28, metalness: 0.24 }));
    root.add(ring);
  } else {
    const sides = hoop.type === 'booster' ? 4 : 6;
    const points = Array.from({ length: sides }, (_, index) => {
      const angle = Math.PI * 2 * index / sides + (hoop.type === 'booster' ? Math.PI / 4 : Math.PI / 6);
      return new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, 0);
    });
    root.add(lineLoop(points, color));
    root.add(lineLoop(points.map((p) => p.clone().multiplyScalar(0.92)), color, 0.35));
    if (hoop.type === 'booster') {
      const lightning = new THREE.Shape();
      lightning.moveTo(0.08, 0.36); lightning.lineTo(-0.19, 0.02); lightning.lineTo(-0.02, 0.02);
      lightning.lineTo(-0.12, -0.35); lightning.lineTo(0.2, 0.02); lightning.lineTo(0.03, 0.02); lightning.closePath();
      const bolt = new THREE.Mesh(new THREE.ShapeGeometry(lightning), new THREE.MeshBasicMaterial({ color: 0xfff2ca, side: THREE.DoubleSide, toneMapped: false }));
      root.add(bolt);
    } else if (hoop.arrow) {
      const vector = hoop.arrow === 'up' ? new THREE.Vector3(0, 1, 0)
        : hoop.arrow === 'down' ? new THREE.Vector3(0, -1, 0)
        : hoop.arrow === 'left' ? new THREE.Vector3(-1, 0, 0) : new THREE.Vector3(1, 0, 0);
      const shaft = new THREE.ArrowHelper(vector, new THREE.Vector3(0, 0, 0), 0.46, 0xf3eaff, 0.18, 0.14);
      root.add(shaft);
    }
  }
  const glow = new THREE.PointLight(color, 1.5, 7); root.add(glow);
  return root;
}

export class FlightWorld {
  readonly scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private plane = createPlane();
  private hoops = new Map<number, { mesh: THREE.Group; signature: string }>();
  private stars: THREE.Points;
  constructor(private host: HTMLElement) {
    const width = host.clientWidth || window.innerWidth;
    const height = host.clientHeight || window.innerHeight;
    this.camera = new THREE.PerspectiveCamera(52, width / height, 0.1, 260);
    this.camera.position.set(0, 2.0, 8.5); this.camera.lookAt(0, 0, -9);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); this.renderer.setSize(width, height);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.14;
    this.renderer.domElement.className = 'flight-canvas'; host.appendChild(this.renderer.domElement);
    this.scene.add(new THREE.HemisphereLight(0xc5eaff, 0x21304b, 1.7));
    const key = new THREE.DirectionalLight(0xfff0dd, 2.6); key.position.set(-4, 10, 8); this.scene.add(key);
    const rim = new THREE.PointLight(0x4fe2d2, 19, 30); rim.position.set(3, 2, -6); this.scene.add(rim);
    this.addFlightBounds();
    const starPositions: number[] = [];
    let seed = 618033;
    const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    for (let i = 0; i < 340; i++) starPositions.push((random() - 0.5) * 70, (random() - 0.5) * 38, -random() * 110 - 15);
    const starGeo = new THREE.BufferGeometry(); starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPositions, 3));
    this.stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xb8d7f6, size: 0.09, transparent: true, opacity: 0.62 }));
    this.scene.add(this.stars);
    this.scene.add(this.plane);
    window.addEventListener('resize', this.resize);
  }
  private addFlightBounds(): void {
    const width = 80 * SCALE; const floor = (10 - 45) * SCALE; const roof = (90 - 45) * SCALE;
    const material = new THREE.LineBasicMaterial({ color: 0x83a9ca, transparent: true, opacity: 0.2 });
    for (let z = -12; z > -126; z -= 12) {
      const points = [
        new THREE.Vector3(-width, floor, z), new THREE.Vector3(width, floor, z),
        new THREE.Vector3(width, roof, z), new THREE.Vector3(-width, roof, z),
      ];
      const geo = new THREE.BufferGeometry().setFromPoints([...points, points[0]]);
      this.scene.add(new THREE.Line(geo, material));
    }
    for (const x of [-width, width]) for (const y of [floor, roof]) {
      const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x, y, 0), new THREE.Vector3(x, y, -126)]);
      this.scene.add(new THREE.Line(geometry, material));
    }
  }
  private resize = (): void => {
    const width = this.host.clientWidth || window.innerWidth; const height = this.host.clientHeight || window.innerHeight;
    this.camera.aspect = width / height; this.camera.updateProjectionMatrix(); this.renderer.setSize(width, height);
  };
  render(state: PlaneState, activeHoops: Hoop[], timeSeconds: number): void {
    this.plane.position.set(state.x * SCALE, (state.y - 45) * SCALE, 0);
    this.plane.rotation.z = -Math.max(-0.28, Math.min(0.28, state.headingX * 2.2));
    this.plane.rotation.x = Math.max(-0.18, Math.min(0.18, state.headingY * 1.4));
    this.camera.position.set(state.x * SCALE, (state.y - 45) * SCALE + 2.0, 8.5);
    this.camera.lookAt(state.x * SCALE, (state.y - 45) * SCALE, -9);
    this.stars.position.z = (timeSeconds * 1.8) % 22;
    const known = new Set<number>();
    for (const hoop of activeHoops) {
      const distance = hoop.z - state.z;
      if (distance < -2 || distance > 1050) continue;
      known.add(hoop.id);
      const signature = `${hoop.type}:${hoop.radius}:${hoop.arrow}`;
      let item = this.hoops.get(hoop.id);
      if (!item || item.signature !== signature) {
        if (item) this.scene.remove(item.mesh);
        item = { mesh: createHoop(hoop), signature };
        this.hoops.set(hoop.id, item); this.scene.add(item.mesh);
      }
      item.mesh.position.set(hoop.x * SCALE, (hoop.y - 45) * SCALE, -distance * SCALE);
      const pulse = 1 + Math.sin(timeSeconds * 3 + hoop.id) * 0.035;
      item.mesh.scale.setScalar(pulse);
    }
    for (const [id, item] of this.hoops) if (!known.has(id)) { this.scene.remove(item.mesh); this.hoops.delete(id); }
    this.renderer.render(this.scene, this.camera);
  }
  dispose(): void {
    window.removeEventListener('resize', this.resize); this.renderer.dispose(); this.renderer.domElement.remove();
  }
}
