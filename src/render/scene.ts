import * as THREE from "three";
import { PlaneState, Hoop, Direction } from "../sim/types";
import { TUNING } from "../../config/tuning";

export class FlightRenderer {
  private container: HTMLElement;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private planeGroup: THREE.Group;
  private propeller: THREE.Mesh;
  private hoopMeshes = new Map<number, THREE.Group>();

  private targetPlaneState: PlaneState | null = null;
  private currentPlaneState: PlaneState | null = null;

  constructor(container: HTMLElement) {
    this.container = container;

    // Scene setup
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a1128);
    this.scene.fog = new THREE.FogExp2(0x0a1128, 0.0018);

    // Camera
    this.camera = new THREE.PerspectiveCamera(
      65,
      window.innerWidth / window.innerHeight,
      0.5,
      2500
    );

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.container.appendChild(this.renderer.domElement);

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    this.scene.add(ambientLight);

    const sunLight = new THREE.DirectionalLight(0xffeedd, 1.2);
    sunLight.position.set(50, 150, -100);
    this.scene.add(sunLight);

    // Environment grids & tunnel boundaries
    this.createEnvironment();

    // Plane model
    const planeData = this.createAirplaneModel();
    this.planeGroup = planeData.group;
    this.propeller = planeData.propeller;
    this.scene.add(this.planeGroup);

    window.addEventListener("resize", this.handleResize);
  }

  private createEnvironment(): void {
    // Flight corridor ground grid
    const gridHelper = new THREE.GridHelper(3000, 60, 0x1f3c88, 0x112244);
    gridHelper.position.y = TUNING.PLAY_VOLUME_Y_MIN;
    this.scene.add(gridHelper);

    // Boundary lines for play volume
    const boundMaterial = new THREE.LineBasicMaterial({
      color: 0x225588,
      transparent: true,
      opacity: 0.35,
    });

    const createBoundLine = (x: number, y: number) => {
      const geometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(x, y, -200),
        new THREE.Vector3(x, y, 100000),
      ]);
      const line = new THREE.Line(geometry, boundMaterial);
      this.scene.add(line);
    };

    createBoundLine(TUNING.PLAY_VOLUME_X_MIN, TUNING.PLAY_VOLUME_Y_MIN);
    createBoundLine(TUNING.PLAY_VOLUME_X_MAX, TUNING.PLAY_VOLUME_Y_MIN);
    createBoundLine(TUNING.PLAY_VOLUME_X_MIN, TUNING.PLAY_VOLUME_Y_MAX);
    createBoundLine(TUNING.PLAY_VOLUME_X_MAX, TUNING.PLAY_VOLUME_Y_MAX);
  }

  private createAirplaneModel(): { group: THREE.Group; propeller: THREE.Mesh } {
    const group = new THREE.Group();

    // Fuselage
    const fuselageGeo = new THREE.ConeGeometry(1.6, 9, 12);
    fuselageGeo.rotateX(Math.PI / 2);
    const fuselageMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.3,
      metalness: 0.2,
    });
    const fuselage = new THREE.Mesh(fuselageGeo, fuselageMat);
    group.add(fuselage);

    // Cockpit Canopy
    const cockpitGeo = new THREE.CapsuleGeometry(0.8, 2.2, 8, 12);
    cockpitGeo.rotateX(Math.PI / 2);
    const cockpitMat = new THREE.MeshStandardMaterial({
      color: 0x00d2ff,
      roughness: 0.1,
      metalness: 0.8,
    });
    const cockpit = new THREE.Mesh(cockpitGeo, cockpitMat);
    cockpit.position.set(0, 0.9, 0.5);
    group.add(cockpit);

    // Main Wings
    const wingGeo = new THREE.BoxGeometry(14, 0.2, 2.6);
    const wingMat = new THREE.MeshStandardMaterial({
      color: 0xe63946,
      roughness: 0.4,
    });
    const wings = new THREE.Mesh(wingGeo, wingMat);
    wings.position.set(0, 0.2, 0);
    group.add(wings);

    // Tail Fin
    const finGeo = new THREE.BoxGeometry(0.2, 2.5, 2.0);
    const fin = new THREE.Mesh(finGeo, wingMat);
    fin.position.set(0, 1.4, -3.8);
    group.add(fin);

    // Tail Wings (horizontal stabilizers)
    const tailWingGeo = new THREE.BoxGeometry(4.5, 0.15, 1.4);
    const tailWings = new THREE.Mesh(tailWingGeo, wingMat);
    tailWings.position.set(0, 0.4, -3.8);
    group.add(tailWings);

    // Propeller
    const propGeo = new THREE.BoxGeometry(3.6, 0.35, 0.08);
    const propMat = new THREE.MeshStandardMaterial({ color: 0x222222 });
    const propeller = new THREE.Mesh(propGeo, propMat);
    propeller.position.set(0, 0, 4.6);
    group.add(propeller);

    return { group, propeller };
  }

  // Create 3D hoop representation according to type
  private createHoopMesh(hoop: Hoop): THREE.Group {
    const group = new THREE.Group();
    group.position.set(hoop.x, hoop.y, hoop.z);

    const radius = hoop.radius;
    const tubeRadius = 0.55;

    if (hoop.type === "standard") {
      // Standard: glowing cyan ring
      const torusGeo = new THREE.TorusGeometry(radius, tubeRadius, 16, 48);
      const torusMat = new THREE.MeshStandardMaterial({
        color: 0x00f0ff,
        emissive: 0x00a8cc,
        emissiveIntensity: 0.8,
        roughness: 0.2,
      });
      const torus = new THREE.Mesh(torusGeo, torusMat);
      group.add(torus);
    } else if (hoop.type === "booster") {
      // Energy booster: energetic green hexagonal ring with chevrons
      const torusGeo = new THREE.TorusGeometry(radius, tubeRadius * 1.3, 6, 6);
      const torusMat = new THREE.MeshStandardMaterial({
        color: 0x00ff88,
        emissive: 0x00ff88,
        emissiveIntensity: 1.2,
        roughness: 0.1,
      });
      const torus = new THREE.Mesh(torusGeo, torusMat);
      torus.rotation.z = Math.PI / 6;
      group.add(torus);

      // Inner boost ring
      const innerGeo = new THREE.TorusGeometry(radius * 0.85, 0.2, 12, 32);
      const innerMat = new THREE.MeshBasicMaterial({ color: 0xafffc8 });
      const inner = new THREE.Mesh(innerGeo, innerMat);
      group.add(inner);
    } else if (hoop.type === "magnetic") {
      // Magnetic: purple/magenta ring with visible directional arrow
      const torusGeo = new THREE.TorusGeometry(radius, tubeRadius, 16, 48);
      const torusMat = new THREE.MeshStandardMaterial({
        color: 0xbf00ff,
        emissive: 0x9900cc,
        emissiveIntensity: 1.0,
      });
      const torus = new THREE.Mesh(torusGeo, torusMat);
      group.add(torus);

      // Magnetic Arrow: clearly pointing toward magnetic direction
      const arrowGroup = this.createDirectionalArrow(hoop.magneticDir || "left", radius);
      group.add(arrowGroup);
    }

    return group;
  }

  private createDirectionalArrow(dir: Direction, radius: number): THREE.Group {
    const arrowGroup = new THREE.Group();
    const arrowMat = new THREE.MeshBasicMaterial({ color: 0xffe600 });

    // Arrow Cone head
    const coneGeo = new THREE.ConeGeometry(radius * 0.22, radius * 0.45, 12);
    const cone = new THREE.Mesh(coneGeo, arrowMat);

    // Arrow Shaft
    const shaftGeo = new THREE.CylinderGeometry(radius * 0.08, radius * 0.08, radius * 0.4, 8);
    const shaft = new THREE.Mesh(shaftGeo, arrowMat);
    shaft.position.y = -radius * 0.25;

    arrowGroup.add(cone);
    arrowGroup.add(shaft);

    // Position arrow on hoop circumference and orient toward direction
    const offset = radius * 1.15;
    switch (dir) {
      case "up":
        arrowGroup.position.set(0, offset, 0);
        arrowGroup.rotation.z = 0;
        break;
      case "down":
        arrowGroup.position.set(0, -offset, 0);
        arrowGroup.rotation.z = Math.PI;
        break;
      case "left":
        arrowGroup.position.set(-offset, 0, 0);
        arrowGroup.rotation.z = Math.PI / 2;
        break;
      case "right":
        arrowGroup.position.set(offset, 0, 0);
        arrowGroup.rotation.z = -Math.PI / 2;
        break;
    }

    return arrowGroup;
  }

  public updateCourseHoops(hoops: Hoop[]): void {
    const activeIds = new Set(hoops.map((h) => h.id));

    // Remove old hoops
    for (const [id, mesh] of this.hoopMeshes.entries()) {
      if (!activeIds.has(id)) {
        this.scene.remove(mesh);
        this.hoopMeshes.delete(id);
      }
    }

    // Add or update active hoops
    for (const hoop of hoops) {
      let mesh = this.hoopMeshes.get(hoop.id);
      if (!mesh) {
        mesh = this.createHoopMesh(hoop);
        this.hoopMeshes.set(hoop.id, mesh);
        this.scene.add(mesh);
      }

      // If cleared or missed, fade out or shrink
      if (hoop.cleared) {
        mesh.scale.set(1.4, 1.4, 1.4);
        mesh.visible = false;
      } else if (hoop.missed) {
        mesh.visible = false;
      }
    }
  }

  public updatePlane(plane: PlaneState): void {
    this.targetPlaneState = plane;
    if (!this.currentPlaneState) {
      this.currentPlaneState = { ...plane };
    }
  }

  public render(): void {
    if (this.currentPlaneState && this.targetPlaneState) {
      // Smooth interpolation
      const alpha = 0.25;
      this.currentPlaneState.x += (this.targetPlaneState.x - this.currentPlaneState.x) * alpha;
      this.currentPlaneState.y += (this.targetPlaneState.y - this.currentPlaneState.y) * alpha;
      this.currentPlaneState.z += (this.targetPlaneState.z - this.currentPlaneState.z) * alpha;
      this.currentPlaneState.pitch +=
        (this.targetPlaneState.pitch - this.currentPlaneState.pitch) * alpha;
      this.currentPlaneState.yaw +=
        (this.targetPlaneState.yaw - this.currentPlaneState.yaw) * alpha;
      this.currentPlaneState.roll +=
        (this.targetPlaneState.roll - this.currentPlaneState.roll) * alpha;

      // Update 3D plane position & orientation
      this.planeGroup.position.set(
        this.currentPlaneState.x,
        this.currentPlaneState.y,
        this.currentPlaneState.z
      );
      this.planeGroup.rotation.set(
        this.currentPlaneState.pitch,
        this.currentPlaneState.yaw,
        this.currentPlaneState.roll
      );

      // Rotate propeller
      this.propeller.rotation.z += 0.8;

      // Chase camera: behind and slightly above the plane, looking ahead
      this.camera.position.set(
        this.currentPlaneState.x * 0.7,
        this.currentPlaneState.y + 5.5,
        this.currentPlaneState.z - 22.0
      );
      this.camera.lookAt(
        this.currentPlaneState.x,
        this.currentPlaneState.y + 1.2,
        this.currentPlaneState.z + 50.0
      );
    }

    this.renderer.render(this.scene, this.camera);
  }

  private handleResize = () => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  };

  public destroy(): void {
    window.removeEventListener("resize", this.handleResize);
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement) {
      this.renderer.domElement.parentElement.removeChild(this.renderer.domElement);
    }
  }
}
