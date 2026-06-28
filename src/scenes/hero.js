/**
 * hero.js — Hero Icosahedron Scene
 * ─────────────────────────────────
 * Low-poly icosahedron with:
 *   - Dark MeshStandardMaterial (metalness 0.9, roughness 0.1)
 *   - White wireframe overlay (LineSegments)
 *   - Slow orbiting white point light
 *   - Cursor-reactive rotation via lerp
 *   - Constant idle rotation on Y-axis
 *
 * Everything registers with the single render loop via onTick().
 * No secondary requestAnimationFrame calls.
 */

import * as THREE from 'three';
import { scene } from '../core/scene.js';
import { camera } from '../core/camera.js';
import { onTick } from '../core/renderer.js';
import { prefersReducedMotion } from '../utils/reducedMotion.js';

// ── Configurable parameters (exposed for dat.GUI) ──
export const heroParams = {
  rotationSpeed: 0.001,
  wireframeOpacity: 0.3,
  lightOrbitSpeed: 0.008,
  lightOrbitRadius: 3.5,
  lightIntensity: 3.0,
  cursorInfluence: 0.8,     // How much cursor affects rotation (radians max)
  lerpFactor: 0.05,         // Smoothness of cursor tracking
};

// ── Geometry ──
// Detail = 0 for true low-poly look (12 vertices, 20 faces)
const geometry = new THREE.IcosahedronGeometry(1.2, 0);

// ── Solid Mesh ──
// Dark reflective surface — metallic, catches the orbiting light beautifully
const material = new THREE.MeshStandardMaterial({
  color: 0x111111,
  metalness: 0.9,
  roughness: 0.1,
  flatShading: true,         // Emphasizes the faceted, low-poly look
});
const icosahedron = new THREE.Mesh(geometry, material);

// ── Wireframe Overlay ──
// White wireframe sits on top, gives the futuristic skeletal look
const wireframeGeometry = new THREE.WireframeGeometry(geometry);
const wireframeMaterial = new THREE.LineBasicMaterial({
  color: 0xffffff,
  transparent: true,
  opacity: heroParams.wireframeOpacity,
  depthTest: true,
});
const wireframe = new THREE.LineSegments(wireframeGeometry, wireframeMaterial);

// Group them together so they rotate as one
const heroGroup = new THREE.Group();
heroGroup.add(icosahedron);
heroGroup.add(wireframe);

// ── Logos ──
const textureLoader = new THREE.TextureLoader();
const logoNames = [
  'University_of_Washington_Block_W_logo_RGB_brand_colors', 'iu_logo', 'harvard_logo', 'ktp_logo', 'python',
  'javascript', 'nodejs', 'threejs', 'cursor', 'antigravity', 'ischool_logo', 'microsoft_logo', 'excel_logo',
  'apple_logo', 'react_logo', 'nvidia_logo', 'usa_flag_logo', 'nchs_logo', 'googlecloud_logo', 'aws_logo'
];
const logoMaterials = logoNames.map(name => {
  const ext = name === 'antigravity' ? 'png' : 'svg';
  const tex = textureLoader.load(`/assets/logos/${name}.${ext}`);
  return new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    opacity: 0.9,
    depthTest: true,
    depthWrite: false,
    side: THREE.DoubleSide
  });
});

const posAttr = geometry.attributes.position;
const indexAttr = geometry.index;
const faces = [];

if (indexAttr) {
  for (let i = 0; i < indexAttr.count; i += 3) {
    const a = indexAttr.getX(i);
    const b = indexAttr.getX(i + 1);
    const c = indexAttr.getX(i + 2);
    faces.push([
      new THREE.Vector3(posAttr.getX(a), posAttr.getY(a), posAttr.getZ(a)),
      new THREE.Vector3(posAttr.getX(b), posAttr.getY(b), posAttr.getZ(b)),
      new THREE.Vector3(posAttr.getX(c), posAttr.getY(c), posAttr.getZ(c))
    ]);
  }
} else {
  for (let i = 0; i < posAttr.count; i += 3) {
    faces.push([
      new THREE.Vector3(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i)),
      new THREE.Vector3(posAttr.getX(i + 1), posAttr.getY(i + 1), posAttr.getZ(i + 1)),
      new THREE.Vector3(posAttr.getX(i + 2), posAttr.getY(i + 2), posAttr.getZ(i + 2))
    ]);
  }
}

// Maps a geometry faceIndex → the logo mesh sitting on that face (if any),
// so the press-and-hold interaction can invert that logo from white to black.
const logoByFace = new Map();

const planeGeom = new THREE.PlaneGeometry(0.4, 0.4);
for (let i = 0; i < logoMaterials.length; i++) {
  // 20 faces: fill every other face first (0, 2, 4…), then the alternates
  // (1, 3, 5…) so additional logos beyond 10 still get their own face.
  const faceIndex = i < 10 ? i * 2 : (i - 10) * 2 + 1;
  if (faceIndex >= faces.length) break;

  const vA = faces[faceIndex][0];
  const vB = faces[faceIndex][1];
  const vC = faces[faceIndex][2];

  // Centroid
  const centroid = new THREE.Vector3()
    .addVectors(vA, vB).add(vC).divideScalar(3);

  // Outward normal (since centered at origin, centroid vector is the normal)
  const outwardNormal = centroid.clone().normalize();

  const mesh = new THREE.Mesh(planeGeom, logoMaterials[i]);
  // Offset slightly outward to avoid z-fighting
  mesh.position.copy(centroid).add(outwardNormal.clone().multiplyScalar(0.02));
  // Look away from center
  mesh.lookAt(centroid.clone().add(outwardNormal));
  // Draw logos above the white fill overlay so the inverted (black) logo
  // stays visible once the tile fills.
  mesh.renderOrder = 2;

  heroGroup.add(mesh);
  logoByFace.set(faceIndex, mesh);
}

// ── Tile click toggle ──
// One white triangular overlay per face. Click/tap a tile to instantly flip it
// white with an inverted (black) logo; click again to revert to black/white.
const fillStates = []; // { mesh, material, logo, active }

for (let faceIndex = 0; faceIndex < faces.length; faceIndex++) {
  const [vA, vB, vC] = faces[faceIndex];

  const outwardNormal = new THREE.Vector3()
    .addVectors(vA, vB).add(vC).divideScalar(3).normalize();
  // Lift the overlay just off the dark face (and below the logo at 0.02).
  const lift = outwardNormal.clone().multiplyScalar(0.012);

  const triGeom = new THREE.BufferGeometry();
  triGeom.setAttribute('position', new THREE.Float32BufferAttribute([
    vA.x + lift.x, vA.y + lift.y, vA.z + lift.z,
    vB.x + lift.x, vB.y + lift.y, vB.z + lift.z,
    vC.x + lift.x, vC.y + lift.y, vC.z + lift.z,
  ], 3));
  triGeom.computeVertexNormals();

  const fillMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0,
    depthTest: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const fillMesh = new THREE.Mesh(triGeom, fillMaterial);
  fillMesh.renderOrder = 1;
  fillMesh.visible = false; // skip rendering entirely while idle
  heroGroup.add(fillMesh);

  fillStates[faceIndex] = {
    mesh: fillMesh,
    material: fillMaterial,
    logo: logoByFace.get(faceIndex) || null,
    active: false,
  };
}

/** Apply instant black/white ↔ white/black visual state for one tile. */
function setTileActive(state, active) {
  state.active = active;
  state.material.opacity = active ? 1 : 0;
  state.mesh.visible = active;
  if (state.logo) state.logo.material.color.setScalar(active ? 0 : 1);
}

// ── Orbiting Point Light ──
// Pure white — the only light source illuminating the icosahedron
const pointLight = new THREE.PointLight(
  0xffffff,
  heroParams.lightIntensity,
  50
);
pointLight.position.set(heroParams.lightOrbitRadius, 0, 0);

// Subtle ambient light so the icosahedron isn't completely invisible
// on the side facing away from the point light
const ambientLight = new THREE.AmbientLight(0xffffff, 0.08);

// ── Mouse & Touch Interaction ──
const DRAG_SENSITIVITY = 0.005;   // radians per pixel dragged
const INERTIA_FRICTION = 0.94;    // how quickly a flick spins down
const INERTIA_CUTOFF = 0.0004;    // velocity below which inertia stops

let isDragging = false;
let previousMousePosition = { x: 0, y: 0 };
const baseRotation = { x: 0, y: 0 };
const currentRotation = { x: 0, y: 0 };
// Flick-to-spin momentum, applied after the user lets go
const rotationVelocity = { x: 0, y: 0 };
let lastInteractionTime = Date.now();

function resetIdleTimer() {
  lastInteractionTime = Date.now();
}

/**
 * Test whether a screen point falls on (or near) the hero object.
 * Projects the object's current world position to screen space so the
 * hit zone follows the object as the scroll camera moves/scales it.
 * Used on touch devices so dragging the object rotates it while dragging
 * elsewhere still scrolls the page normally.
 */
const _projected = new THREE.Vector3();
function isPointerOnObject(clientX, clientY) {
  heroGroup.getWorldPosition(_projected);
  _projected.project(camera);

  // Behind the camera / outside the frustum depth → not interactable
  if (_projected.z > 1) return false;

  const screenX = (_projected.x * 0.5 + 0.5) * window.innerWidth;
  const screenY = (-_projected.y * 0.5 + 0.5) * window.innerHeight;

  // Generous, finger-friendly radius around the object's centre
  const radius = Math.max(120, Math.min(window.innerWidth, window.innerHeight) * 0.32);

  return Math.hypot(clientX - screenX, clientY - screenY) <= radius;
}

function applyDrag(deltaX, deltaY) {
  const rotY = deltaX * DRAG_SENSITIVITY;
  const rotX = deltaY * DRAG_SENSITIVITY;

  baseRotation.y += rotY;
  baseRotation.x += rotX;

  // Track the latest movement as velocity for flick-to-spin momentum
  rotationVelocity.y = rotY;
  rotationVelocity.x = rotX;
}

// ── Tile click toggle (raycast) ──
const raycaster = new THREE.Raycaster();
const _pointer = new THREE.Vector2();
const CLICK_THRESHOLD = 6; // px — above this counts as a drag, not a tile click
let pointerDownPos = null;

/**
 * Raycast a screen point against the icosahedron and toggle that tile's
 * contrast scheme (black/white ↔ white/black).
 */
function toggleTileAt(clientX, clientY) {
  _pointer.x = (clientX / window.innerWidth) * 2 - 1;
  _pointer.y = -(clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(_pointer, camera);

  const hit = raycaster.intersectObject(icosahedron, false)[0];
  if (!hit || hit.faceIndex == null) return;

  const state = fillStates[hit.faceIndex];
  if (!state) return;

  setTileActive(state, !state.active);
}

/** Toggle on tap/click; ignore if the pointer moved enough to spin the object. */
function tryToggleTile(clientX, clientY) {
  if (!pointerDownPos) return;
  const moved = Math.hypot(clientX - pointerDownPos.x, clientY - pointerDownPos.y);
  pointerDownPos = null;
  if (moved > CLICK_THRESHOLD) return;
  toggleTileAt(clientX, clientY);
}

// ── Mouse (desktop): drag anywhere to rotate ──
function onMouseDown(event) {
  isDragging = true;
  rotationVelocity.x = 0;
  rotationVelocity.y = 0;
  resetIdleTimer();
  previousMousePosition = { x: event.clientX, y: event.clientY };
  pointerDownPos = { x: event.clientX, y: event.clientY };
}

function onMouseUp(event) {
  isDragging = false;
  resetIdleTimer();
  if (event?.clientX != null) {
    tryToggleTile(event.clientX, event.clientY);
  } else {
    pointerDownPos = null;
  }
}

function onMouseMove(event) {
  resetIdleTimer();
  if (isDragging) {
    applyDrag(
      event.clientX - previousMousePosition.x,
      event.clientY - previousMousePosition.y
    );
    previousMousePosition = { x: event.clientX, y: event.clientY };
  }
}

// ── Touch (mobile): drag the object to rotate, scroll elsewhere ──
function onTouchStart(event) {
  if (event.touches.length !== 1) return;

  const touch = event.touches[0];
  if (!isPointerOnObject(touch.clientX, touch.clientY)) return;

  isDragging = true;
  rotationVelocity.x = 0;
  rotationVelocity.y = 0;
  resetIdleTimer();
  previousMousePosition = { x: touch.clientX, y: touch.clientY };
  pointerDownPos = { x: touch.clientX, y: touch.clientY };
}

function onTouchEnd(event) {
  isDragging = false;
  resetIdleTimer();
  const touch = event.changedTouches[0];
  if (touch) tryToggleTile(touch.clientX, touch.clientY);
  else pointerDownPos = null;
}

function onTouchMove(event) {
  if (!isDragging || event.touches.length !== 1) return;

  // We started on the object → take over the gesture and stop the
  // page/Lenis from scrolling while the user spins it.
  if (event.cancelable) event.preventDefault();

  resetIdleTimer();
  const touch = event.touches[0];
  applyDrag(
    touch.clientX - previousMousePosition.x,
    touch.clientY - previousMousePosition.y
  );
  previousMousePosition = { x: touch.clientX, y: touch.clientY };
}

/**
 * Initialize the hero scene.
 * Adds objects to the Three.js scene and registers the animation tick.
 */
export function initHero() {
  // Position the icosahedron on the right side of the viewport
  // to complement the left-aligned hero text (split layout)
  heroGroup.position.set(2.5, 0.3, 0);

  scene.add(heroGroup);
  scene.add(pointLight);
  scene.add(ambientLight);

  // Listen for mouse events
  window.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mouseup', onMouseUp);
  window.addEventListener('mouseleave', onMouseUp);
  window.addEventListener('mousemove', onMouseMove, { passive: true });

  // Listen for touch events.
  // touchmove is non-passive so we can preventDefault() to stop the page
  // from scrolling while the user is spinning the object.
  window.addEventListener('touchstart', onTouchStart, { passive: true });
  window.addEventListener('touchend', onTouchEnd, { passive: true });
  window.addEventListener('touchcancel', onTouchEnd, { passive: true });
  window.addEventListener('touchmove', onTouchMove, { passive: false });

  // Register animation callback with the single render loop
  onTick(updateHero);
}

/**
 * Per-frame update — called by the main render loop.
 * Handles idle rotation, click-and-drag, and light orbiting.
 */
function updateHero(elapsedTime, deltaTime) {
  if (!isDragging) {
    // ── Flick-to-spin momentum ──
    // Carry the user's release velocity, decaying with friction.
    if (rotationVelocity.x !== 0 || rotationVelocity.y !== 0) {
      baseRotation.y += rotationVelocity.y;
      baseRotation.x += rotationVelocity.x;
      rotationVelocity.y *= INERTIA_FRICTION;
      rotationVelocity.x *= INERTIA_FRICTION;
      if (Math.abs(rotationVelocity.y) < INERTIA_CUTOFF) rotationVelocity.y = 0;
      if (Math.abs(rotationVelocity.x) < INERTIA_CUTOFF) rotationVelocity.x = 0;
    } else if (!prefersReducedMotion) {
      // ── Idle rotation (only once momentum has fully settled) ──
      const isIdle = (Date.now() - lastInteractionTime) > 2000;
      baseRotation.y += isIdle
        ? heroParams.rotationSpeed * 5  // Faster constant spin when left idle
        : heroParams.rotationSpeed;
    }
  }

  // ── Dragging & Smooth interpolation ──
  // Lerp toward target for smoothness
  currentRotation.x += (baseRotation.x - currentRotation.x) * heroParams.lerpFactor * 2;
  currentRotation.y += (baseRotation.y - currentRotation.y) * heroParams.lerpFactor * 2;

  heroGroup.rotation.x = currentRotation.x;
  heroGroup.rotation.y = currentRotation.y;

  // ── Orbiting point light ──
  if (!prefersReducedMotion) {
    const angle = elapsedTime * heroParams.lightOrbitSpeed * 60; // Normalize for speed param
    pointLight.position.x = Math.cos(angle) * heroParams.lightOrbitRadius;
    pointLight.position.z = Math.sin(angle) * heroParams.lightOrbitRadius;
    pointLight.position.y = Math.sin(angle * 0.5) * 1.5; // Slight vertical bob
  }

  // ── Sync GUI-driven parameters ──
  wireframeMaterial.opacity = heroParams.wireframeOpacity;
  pointLight.intensity = heroParams.lightIntensity;
}

export { heroGroup, icosahedron, wireframe, pointLight };
