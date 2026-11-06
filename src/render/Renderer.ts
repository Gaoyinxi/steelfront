import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';

/** Sun position: elevation above the horizon and azimuth (degrees). */
const SUN_ELEVATION = 32;
const SUN_AZIMUTH = 140;

/**
 * Owns the three.js renderer, scene, sky, lighting and atmosphere.
 *
 * Lighting is physically based: a Preetham atmospheric-scattering sky, an
 * environment map pre-filtered from that sky (image-based ambient light and
 * reflections for PBR materials) and a directional sun aligned with the sky's
 * sun disc, rendered with ACES filmic tone mapping.
 */
export class Renderer {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly gl: THREE.WebGLRenderer;
  private readonly sun: THREE.DirectionalLight;
  private readonly sunOffset: THREE.Vector3;

  constructor(container: HTMLElement) {
    this.gl = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.gl.setSize(window.innerWidth, window.innerHeight);
    this.gl.shadowMap.enabled = true;
    this.gl.shadowMap.type = THREE.PCFShadowMap;
    this.gl.toneMapping = THREE.ACESFilmicToneMapping;
    this.gl.toneMappingExposure = 0.5;
    container.appendChild(this.gl.domElement);

    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 6000);

    const sunDir = new THREE.Vector3().setFromSphericalCoords(
      1,
      THREE.MathUtils.degToRad(90 - SUN_ELEVATION),
      THREE.MathUtils.degToRad(SUN_AZIMUTH),
    );

    // Sky dome.
    const sky = this.makeSky(sunDir);
    this.scene.add(sky);

    // Image-based lighting: pre-filter a sky-only scene into an environment map.
    const pmrem = new THREE.PMREMGenerator(this.gl);
    const envScene = new THREE.Scene();
    envScene.add(this.makeSky(sunDir));
    this.scene.environment = pmrem.fromScene(envScene, 0.02).texture;
    this.scene.environmentIntensity = 0.5;
    pmrem.dispose();

    // Aerial perspective: distance haze in the horizon colour.
    this.scene.fog = new THREE.FogExp2(0xbcc8cf, 0.00105);

    // Sun.
    this.sun = new THREE.DirectionalLight(0xfff0dc, 3.6);
    this.sunOffset = sunDir.clone().multiplyScalar(320);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -70;
    sc.right = 70;
    sc.top = 70;
    sc.bottom = -70;
    sc.near = 20;
    sc.far = 800;
    this.sun.shadow.bias = -0.00025;
    this.sun.shadow.normalBias = 0.35;
    this.scene.add(this.sun, this.sun.target);

    window.addEventListener('resize', () => this.resize());
  }

  get canvas(): HTMLCanvasElement {
    return this.gl.domElement;
  }

  /** Keeps the shadow frustum centred on the area of interest (texel-snapped to avoid shimmering). */
  focusShadows(center: THREE.Vector3): void {
    const texel = (this.sun.shadow.camera.right - this.sun.shadow.camera.left) / this.sun.shadow.mapSize.x;
    const c = new THREE.Vector3(
      Math.round(center.x / texel) * texel,
      Math.round(center.y / texel) * texel,
      Math.round(center.z / texel) * texel,
    );
    this.sun.position.copy(c).add(this.sunOffset);
    this.sun.target.position.copy(c);
  }

  render(): void {
    this.gl.render(this.scene, this.camera);
  }

  private makeSky(sunDir: THREE.Vector3): Sky {
    const sky = new Sky();
    sky.scale.setScalar(5000);
    const u = sky.material.uniforms;
    u.turbidity.value = 4.5;
    u.rayleigh.value = 1.3;
    u.mieCoefficient.value = 0.004;
    u.mieDirectionalG.value = 0.82;
    u.sunPosition.value.copy(sunDir);
    return sky;
  }

  private resize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.gl.setSize(window.innerWidth, window.innerHeight);
  }
}
