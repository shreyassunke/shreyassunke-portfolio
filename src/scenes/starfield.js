/**
 * starfield.js — Immersive NASA Starfield Background
 * ────────────────────────────────────────────────────
 * Two-layer 360° starfield that envelops the entire scene:
 *
 *   Layer 1: Equirectangular Skybox Sphere
 *     - NASA Milky Way panorama mapped to a large inverted sphere
 *     - MeshBasicMaterial (unlit — stars glow on their own)
 *     - Slowly rotates, coupled to the hero icosahedron's rotation
 *
 *   Layer 2: Procedural Particle Stars
 *     - 4,000 GPU-driven points with custom ShaderMaterial
 *     - Per-star twinkle animation (opacity oscillation)
 *     - Size attenuation for depth perception
 *     - Slight counter-rotation for parallax depth
 *
 * Both layers sync with the hero object's rotation at a dampened
 * ratio, creating an immersive "you're inside the galaxy" feel.
 *
 * Registers with the single render loop via onTick().
 */

import * as THREE from 'three';
import { scene } from '../core/scene.js';
import { onTick } from '../core/renderer.js';

// ── Configurable parameters ──
const starfieldParams = {
  skyboxRotationSpeed: 0.00015,    // Autonomous skybox rotation speed
  particleRotationSpeed: 0.0001,   // Autonomous particle rotation speed (same direction as skybox, slightly slower for subtle parallax)
  heroCoupling: 0.08,              // How much hero rotation affects starfield (0–1)
  starCount: 4000,                 // Number of procedural particle stars
  skyboxRadius: 500,               // Radius of the skybox sphere
  particleMinRadius: 50,           // Closest particle distance
  particleMaxRadius: 450,          // Farthest particle distance
  twinkleSpeed: 1.5,               // Speed of star twinkle
};

// ── References (set during init) ──
let skyboxMesh = null;
let particleSystem = null;
let heroGroupRef = null;
let skyboxBaseRotation = { x: 0, y: 0 };
let particleBaseRotation = { x: 0, y: 0 };

// ══════════════════════════════════════════
// Layer 1: Equirectangular Skybox & Environment Map
// ══════════════════════════════════════════

function createSkybox() {
  const textureLoader = new THREE.TextureLoader();
  textureLoader.load('/assets/eso_milky_way.jpg', (texture) => {
    // Set proper mapping for both background and environment reflections
    texture.mapping = THREE.EquirectangularReflectionMapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;

    // Set as background and environment map
    scene.background = texture;
    scene.environment = texture;
    
    // Dark theme: dim the background but keep reflections strong
    scene.backgroundIntensity = 0.15; 
    scene.environmentIntensity = 1.0;
  });
}

// ══════════════════════════════════════════
// Layer 2: Procedural Particle Stars
// ══════════════════════════════════════════

// Custom vertex shader — handles size attenuation and passes
// per-star random offset to fragment shader for twinkle
const starVertexShader = /* glsl */ `
  attribute float aSize;
  attribute float aOffset;
  attribute float aBrightness;

  varying float vOffset;
  varying float vBrightness;

  uniform float uPixelRatio;

  void main() {
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);

    // Size attenuation — farther stars appear smaller
    gl_PointSize = aSize * uPixelRatio * (200.0 / -mvPosition.z);
    // Keep a minimum of ~1.5px: points smaller than a pixel rasterize
    // unstably as they drift, causing the whole field to sparkle/flicker.
    gl_PointSize = clamp(gl_PointSize, 1.5, 8.0);

    gl_Position = projectionMatrix * mvPosition;

    vOffset = aOffset;
    vBrightness = aBrightness;
  }
`;

// Custom fragment shader — circular point with twinkle
const starFragmentShader = /* glsl */ `
  uniform float uTime;
  uniform float uTwinkleSpeed;

  varying float vOffset;
  varying float vBrightness;

  void main() {
    // Circular point shape (discard corners of the point square)
    vec2 center = gl_PointCoord - 0.5;
    float dist = length(center);
    if (dist > 0.5) discard;

    // Soft falloff from center
    float alpha = 1.0 - smoothstep(0.0, 0.5, dist);

    // Twinkle: oscillate brightness using sin with per-star offset
    float twinkle = 0.6 + 0.4 * sin(uTime * uTwinkleSpeed + vOffset);

    // Final color — warm white with subtle blue/yellow variation
    vec3 warmWhite = vec3(0.95, 0.93, 0.88);
    vec3 coolBlue = vec3(0.8, 0.85, 1.0);
    vec3 starColor = mix(warmWhite, coolBlue, vBrightness * 0.3);

    gl_FragColor = vec4(starColor, alpha * twinkle * vBrightness);
  }
`;

function createParticleStars() {
  const count = starfieldParams.starCount;
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const offsets = new Float32Array(count);
  const brightness = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    // Random spherical distribution between min and max radius
    const r = starfieldParams.particleMinRadius +
      Math.random() * (starfieldParams.particleMaxRadius - starfieldParams.particleMinRadius);
    const theta = Math.random() * Math.PI * 2;          // azimuth
    const phi = Math.acos(2 * Math.random() - 1);       // polar (uniform)

    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    positions[i * 3 + 2] = r * Math.cos(phi);

    // Random size — most stars small, a few bright ones larger
    const isBright = Math.random() > 0.95;
    sizes[i] = isBright ? 2.0 + Math.random() * 3.0 : 0.5 + Math.random() * 1.5;

    // Random phase offset for twinkle desynchronization
    offsets[i] = Math.random() * Math.PI * 2 * 10;

    // Brightness variation
    brightness[i] = isBright ? 0.8 + Math.random() * 0.2 : 0.3 + Math.random() * 0.5;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('aOffset', new THREE.BufferAttribute(offsets, 1));
  geometry.setAttribute('aBrightness', new THREE.BufferAttribute(brightness, 1));

  const material = new THREE.ShaderMaterial({
    vertexShader: starVertexShader,
    fragmentShader: starFragmentShader,
    uniforms: {
      uTime: { value: 0.0 },
      uTwinkleSpeed: { value: starfieldParams.twinkleSpeed },
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,  // Stars glow additively
  });

  particleSystem = new THREE.Points(geometry, material);
  particleSystem.renderOrder = -1;  // After skybox, before scene objects
  scene.add(particleSystem);

  // Update pixel ratio on resize
  window.addEventListener('resize', () => {
    material.uniforms.uPixelRatio.value = Math.min(window.devicePixelRatio, 2);
  });

  return particleSystem;
}

// ══════════════════════════════════════════
// Per-Frame Update
// ══════════════════════════════════════════

function updateStarfield(elapsedTime, _deltaTime) {
  if (!particleSystem) return;

  // ── Autonomous rotation ──
  skyboxBaseRotation.y += starfieldParams.skyboxRotationSpeed;
  // Rotate the particle layer in the SAME direction as the skybox (just slower)
  // so the two star layers read as one coherent field with gentle parallax.
  // Counter-rotating them made the two starfields visibly slide against each
  // other, which looked like flickering/glitching between two starfields.
  particleBaseRotation.y += starfieldParams.particleRotationSpeed;

  // ── Hero coupling ──
  // Read the hero group's current rotation and apply a dampened fraction
  let heroInfluenceX = 0;
  let heroInfluenceY = 0;

  if (heroGroupRef) {
    heroInfluenceX = heroGroupRef.rotation.x * starfieldParams.heroCoupling;
    heroInfluenceY = heroGroupRef.rotation.y * starfieldParams.heroCoupling;
  }

  // ── Apply rotations ──
  const rotX = skyboxBaseRotation.x + heroInfluenceX;
  const rotY = skyboxBaseRotation.y + heroInfluenceY;
  
  if (scene.backgroundRotation) {
    scene.backgroundRotation.set(rotX, rotY, 0);
    scene.environmentRotation.set(rotX, rotY, 0);
  } else if (skyboxMesh) {
    // Fallback for older three.js versions if needed
    skyboxMesh.rotation.x = rotX;
    skyboxMesh.rotation.y = rotY;
  }

  // Particles rotate in opposite direction for depth
  particleSystem.rotation.x = particleBaseRotation.x + heroInfluenceX * 0.5;
  particleSystem.rotation.y = particleBaseRotation.y + heroInfluenceY * 0.5;

  // ── Update shader uniforms ──
  particleSystem.material.uniforms.uTime.value = elapsedTime;
}

// ══════════════════════════════════════════
// Initialization
// ══════════════════════════════════════════

/**
 * Initialize the starfield background.
 * Must be called after scene.js is imported.
 * Call setHeroRef() after hero.js initializes to enable rotation coupling.
 */
export function initStarfield() {
  createSkybox();
  createParticleStars();

  // Register per-frame update with the single render loop
  onTick(updateStarfield);

  console.log(
    '%c[Starfield] NASA 360° skybox + %d particle stars initialized.',
    'color: #6af; font-family: monospace;',
    starfieldParams.starCount
  );
}

/**
 * Set the hero group reference for rotation coupling.
 * Called after hero.js has created the heroGroup.
 */
export function setHeroRef(group) {
  heroGroupRef = group;
}

export { starfieldParams };
