import * as THREE from 'three';

/** Owns the three.js renderer, scene, lighting and atmosphere. */
export class Renderer {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly gl: THREE.WebGLRenderer;
  private readonly sun: THREE.DirectionalLight;
  private readonly sunOffset = new THREE.Vector3(180, 260, 120);

  constructor(container: HTMLElement) {
    this.gl = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.gl.setSize(window.innerWidth, window.innerHeight);
    this.gl.shadowMap.enabled = true;
    this.gl.shadowMap.type = THREE.PCFShadowMap;
    this.gl.toneMapping = THREE.ACESFilmicToneMapping;
    this.gl.toneMappingExposure = 1.05;
    container.appendChild(this.gl.domElement);

    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 4000);

    const sky = new THREE.Color(0xa9c3d6);
    this.scene.background = sky;
    this.scene.fog = new THREE.FogExp2(0xb4c7d3, 0.0014);

    this.scene.add(new THREE.HemisphereLight(0xcfe3f2, 0x5a5440, 1.25));
    this.sun = new THREE.DirectionalLight(0xfff1d6, 2.4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -90;
    sc.right = 90;
    sc.top = 90;
    sc.bottom = -90;
    sc.near = 10;
    sc.far = 700;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.6;
    this.scene.add(this.sun, this.sun.target);

    window.addEventListener('resize', () => this.resize());
  }

  get canvas(): HTMLCanvasElement {
    return this.gl.domElement;
  }

  /** Keeps the shadow frustum centred on the area of interest. */
  focusShadows(center: THREE.Vector3): void {
    this.sun.position.copy(center).add(this.sunOffset);
    this.sun.target.position.copy(center);
  }

  render(): void {
    this.gl.render(this.scene, this.camera);
  }

  private resize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.gl.setSize(window.innerWidth, window.innerHeight);
  }
}
