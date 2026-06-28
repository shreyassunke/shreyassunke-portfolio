/**
 * heroText3D.js — Hero Text as 3D Glass-Metallic Blocks
 * ───────────────────────────────────────────────────────
 * Replaces the flat particle headline with real extruded 3D type.
 *
 * The hero name is built with Three.js `TextGeometry` (extruded depth +
 * generously beveled, rounded "fillet" edges — no sharp corners) and shaded
 * with a polished black/white `MeshPhysicalMaterial` (high metalness +
 * clearcoat + environment reflections) so the letters read like cut glass /
 * chromed blocks. A small procedurally-generated black-to-white "studio"
 * environment supplies the glassy highlights that sweep across the rounded
 * edges as the text idles, tilts toward the cursor, and flips between phrases.
 *
 * Rendered on its own overlay canvas (perspective camera) that is kept locked
 * over the HTML <h1>, exactly like the previous particle overlay — so it stays
 * aligned through layout, scroll, and resize while the HTML text is hidden.
 *
 * The same two-phrase loop is preserved ("Shreyas Sunke" ⇄ "Software
 * Developer") but morphs as a 3D card-flip: one phrase flips up and away while
 * the next flips down into place.
 */

import * as THREE from 'three';
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js';
import { FontLoader } from 'three/examples/jsm/loaders/FontLoader.js';
import gsap from 'gsap';
import { prefersReducedMotion } from '../utils/reducedMotion.js';

// ── Module State ──
let renderer, textScene, camera;
let rootGroup = null;          // holds both phrase meshes; receives tilt/idle
let meshes = [];               // [meshA, meshB]
let overlayCanvas = null;
let heroElement = null;
let font = null;
let envMap = null;
let isInitialized = false;
let overlayPadding = 100;
let overlayCssWidth = 0;
let phrases = [];
let morphTimeline = null;
let activeIndex = 0;           // which phrase mesh is currently shown

// Interaction state
let isHovering = false;
let mouseTiltX = 0;            // target tilt from cursor
let mouseTiltY = 0;
let smoothTiltX = 0;           // eased tilt actually applied
let smoothTiltY = 0;

// ── Configuration ──
const FONT_URL = '/fonts/helvetiker_bold.typeface.json';
const FOV = 28;                       // gentle perspective so depth/bevels read
const SIZE_FACTOR = 1.0;              // glyph size relative to hero font-size
const DEPTH_FACTOR = 0.26;            // extrusion depth (block thickness)
const BEVEL_THICK_FACTOR = 0.055;     // how far the rounded edge cuts inward (z)
const BEVEL_SIZE_FACTOR = 0.045;      // how far the rounded edge cuts inward (xy)
const BEVEL_SEGMENTS = 8;             // high = smooth, round fillet (no corners)
const CURVE_SEGMENTS = 12;            // smoothness of glyph curves
const FILL_RATIO = 0.96;              // fraction of content width the text fills
const TEXT_LETTER_SPACING_EM = -0.025;
const TEXT_WIDTH_BUFFER = 8;

// ── Morph timing ──
const HOLD_DURATION = 5.0;
const TRANSITION_DURATION = 1.0;

// ── Tilt / idle motion ──
const TILT_MAX_X = 0.32;              // radians of tilt at cursor extremes
const TILT_MAX_Y = 0.5;
const TILT_EASE = 0.08;
const IDLE_AMP_X = 0.05;              // gentle constant float so glints move
const IDLE_AMP_Y = 0.12;
const IDLE_SPEED_X = 0.4;
const IDLE_SPEED_Y = 0.55;

// ────────────────────────────────────────────────────────
// Environment — procedural black→white studio reflections
// ────────────────────────────────────────────────────────

/**
 * Build a small equirectangular black-to-white gradient with a bright soft
 * "softbox" near the top, then prefilter it (PMREM) into an environment map.
 * Pure greyscale keeps the reflections strictly on-theme (b/w) while giving the
 * rounded glass edges a moving highlight to catch.
 */
function generateEnvMap(rendererInstance) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const ctx = c.getContext('2d');

  // Base vertical gradient: bright "sky", darker mid, mid-grey "floor".
  // Kept fairly light overall so the metal reflects something visible rather
  // than the near-black starfield behind the overlay.
  const base = ctx.createLinearGradient(0, 0, 0, 256);
  base.addColorStop(0.0, '#b8b8b8');
  base.addColorStop(0.42, '#3a3a3a');
  base.addColorStop(0.5, '#2a2a2a');
  base.addColorStop(0.58, '#3a3a3a');
  base.addColorStop(1.0, '#6a6a6a');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 512, 256);

  // Main softbox highlight (top center) — the primary glassy glint.
  const key = ctx.createRadialGradient(256, 46, 8, 256, 46, 190);
  key.addColorStop(0.0, 'rgba(255,255,255,1)');
  key.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  key.addColorStop(1.0, 'rgba(255,255,255,0)');
  ctx.fillStyle = key;
  ctx.fillRect(0, 0, 512, 170);

  // A couple of offset, dimmer highlights for richer moving reflections.
  const glint = (x, y, r, a) => {
    const g = ctx.createRadialGradient(x, y, 2, x, y, r);
    g.addColorStop(0.0, `rgba(255,255,255,${a})`);
    g.addColorStop(1.0, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  };
  glint(70, 70, 90, 0.5);
  glint(440, 90, 80, 0.4);

  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;

  const pmrem = new THREE.PMREMGenerator(rendererInstance);
  const env = pmrem.fromEquirectangular(tex).texture;

  tex.dispose();
  pmrem.dispose();
  return env;
}

// ────────────────────────────────────────────────────────
// Geometry / Material
// ────────────────────────────────────────────────────────

function createMaterial() {
  return new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    // Moderate (not full) metalness so the white base colour stays visible
    // against the dark scene; full metal reflected only the black starfield
    // and disappeared. Clearcoat + env reflections keep the glassy read.
    metalness: 0.55,
    roughness: 0.18,
    clearcoat: 1.0,
    clearcoatRoughness: 0.1,
    reflectivity: 1.0,
    envMap,
    envMapIntensity: 1.5,
    // A subtle self-lit floor so the letters never collapse to pure black.
    emissive: 0xffffff,
    emissiveIntensity: 0.18,
    transparent: true,   // needed for the flip cross-fade
    opacity: 1.0,
  });
}

/**
 * Build a centered, beveled 3D text mesh for one phrase.
 * Returns the mesh plus its un-scaled bounding size (font units).
 */
function buildPhraseMesh(text, fontSizePx) {
  const geometry = new TextGeometry(text, {
    font,
    size: fontSizePx * SIZE_FACTOR,
    depth: fontSizePx * DEPTH_FACTOR,
    curveSegments: CURVE_SEGMENTS,
    bevelEnabled: true,
    bevelThickness: fontSizePx * BEVEL_THICK_FACTOR,
    bevelSize: fontSizePx * BEVEL_SIZE_FACTOR,
    bevelOffset: 0,
    bevelSegments: BEVEL_SEGMENTS,
  });

  geometry.computeBoundingBox();
  const bb = geometry.boundingBox;
  const cx = (bb.max.x + bb.min.x) / 2;
  const cy = (bb.max.y + bb.min.y) / 2;
  const cz = (bb.max.z + bb.min.z) / 2;
  geometry.translate(-cx, -cy, -cz); // center about origin for clean flips

  const mesh = new THREE.Mesh(geometry, createMaterial());
  mesh.width = bb.max.x - bb.min.x;
  mesh.height = bb.max.y - bb.min.y;
  return mesh;
}

/**
 * (Re)build both phrase meshes, scale them to fit the overlay width, and add
 * them to the root group. The wider phrase sets the shared scale so both
 * phrases render at a consistent size.
 */
function buildText(fontSizePx, contentWidthPx) {
  // Tear down any previous meshes.
  for (const m of meshes) {
    rootGroup.remove(m);
    m.geometry.dispose();
    m.material.dispose();
  }
  meshes = [];

  const [phraseA, phraseB] = phrases;
  const meshA = buildPhraseMesh(phraseA, fontSizePx);
  const meshB = buildPhraseMesh(phraseB || phraseA, fontSizePx);

  // Fit-to-width: scale so the widest phrase fills the available content width.
  const maxWidth = Math.max(meshA.width, meshB.width);
  const targetWidth = contentWidthPx * FILL_RATIO;
  const scale = maxWidth > 0 ? targetWidth / maxWidth : 1;
  meshA.scale.setScalar(scale);
  meshB.scale.setScalar(scale);

  // Initial morph state: A shown flat, B hidden flipped up edge-on.
  meshA.rotation.x = 0;
  meshA.material.opacity = 1;
  meshA.visible = true;

  meshB.rotation.x = Math.PI / 2;
  meshB.material.opacity = 0;
  meshB.visible = false;

  rootGroup.add(meshA);
  rootGroup.add(meshB);
  meshes = [meshA, meshB];
  activeIndex = 0;
}

// ────────────────────────────────────────────────────────
// Overlay canvas — mirrors the previous particle overlay layout
// ────────────────────────────────────────────────────────

function measureTextWidth(text, fontSize) {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  ctx.font = `600 ${fontSize}px Inter, system-ui, sans-serif`;
  if ('letterSpacing' in ctx) {
    ctx.letterSpacing = `${TEXT_LETTER_SPACING_EM * fontSize}px`;
  }
  return ctx.measureText(text).width;
}

// Mobile uses the centered hero layout (see the max-width:768px rules in
// main.css). Keep this breakpoint in sync with that CSS.
const MOBILE_BREAKPOINT = 768;

/**
 * Whether the centered (mobile) hero layout is active.
 *
 * Evaluated live off `window.innerWidth` on every call rather than caching a
 * `MediaQueryList`. iOS Safari can report a stale `.matches` on a MediaQueryList
 * created at module-load (before the viewport settles) that never had a
 * listener attached — which made the overlay fall back to the desktop anchor
 * and stick the headline to one side on load.
 */
function isMobileLayout() {
  return window.innerWidth <= MOBILE_BREAKPOINT;
}

function overlayAnchorX(rect) {
  if (isMobileLayout()) return window.innerWidth / 2;
  return rect.left + rect.width / 2;
}

function positionOverlay(heroEl, contentWidth) {
  const rect = heroEl.getBoundingClientRect();
  const padding = 100;
  overlayPadding = padding;
  const innerWidth = contentWidth != null ? contentWidth : rect.width;
  const width = innerWidth + padding * 2;
  const height = rect.height + padding * 2;
  overlayCssWidth = width;

  const dpr = Math.min(window.devicePixelRatio, 2);
  overlayCanvas.width = Math.ceil(width * dpr);
  overlayCanvas.height = Math.ceil(height * dpr);
  overlayCanvas.style.width = `${width}px`;
  overlayCanvas.style.height = `${height}px`;
  overlayCanvas.style.left = `${overlayAnchorX(rect) - width / 2}px`;
  overlayCanvas.style.top = `${rect.top - padding}px`;

  return { width, height, padding, innerWidth };
}

function updateOverlayPosition() {
  if (!overlayCanvas || !heroElement) return;
  const rect = heroElement.getBoundingClientRect();
  overlayCanvas.style.left = `${overlayAnchorX(rect) - overlayCssWidth / 2}px`;
  overlayCanvas.style.top = `${rect.top - overlayPadding}px`;
}

/**
 * Place the camera so that one world unit ≈ one CSS pixel at the z=0 plane,
 * keeping the extruded text visually sized to the HTML headline.
 */
function configureCamera(width, height) {
  const aspect = width / height;
  const dist = (height / 2) / Math.tan((FOV * Math.PI) / 180 / 2);
  if (!camera) {
    camera = new THREE.PerspectiveCamera(FOV, aspect, 0.1, 5000);
  } else {
    camera.aspect = aspect;
  }
  camera.position.set(0, 0, dist);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
}

// ────────────────────────────────────────────────────────
// Initialization
// ────────────────────────────────────────────────────────

export function initHeroText3D() {
  if (prefersReducedMotion) return; // leave the plain HTML headline visible

  heroElement = document.querySelector('.hero__name');
  if (!heroElement) return;

  const fontLoader = new FontLoader();
  fontLoader.load(
    FONT_URL,
    (loadedFont) => {
      font = loadedFont;
      setupScene();
    },
    undefined,
    (err) => {
      // Font failed: fall back to the readable HTML headline.
      console.warn('[heroText3D] font load failed, keeping HTML text', err);
      heroElement.style.color = '';
    }
  );
}

function setupScene() {
  overlayCanvas = document.createElement('canvas');
  overlayCanvas.classList.add('particle-canvas'); // reuse fixed-overlay styling
  document.body.appendChild(overlayCanvas);

  const computed = window.getComputedStyle(heroElement);
  const fontSize = parseFloat(computed.fontSize);

  const phraseA = heroElement.getAttribute('aria-label')
    || heroElement.textContent.replace(/\u00a0/g, ' ');
  const taglineEl = document.querySelector('.hero__tagline');
  const phraseB = (taglineEl && taglineEl.textContent.trim()) || phraseA;
  phrases = [phraseA, phraseB];

  const widthA = measureTextWidth(phraseA, fontSize);
  const widthB = measureTextWidth(phraseB, fontSize);
  const sampleWidth = Math.ceil(Math.max(widthA, widthB)) + TEXT_WIDTH_BUFFER;
  const { width, height, innerWidth } = positionOverlay(heroElement, sampleWidth);

  const dpr = Math.min(window.devicePixelRatio, 2);
  renderer = new THREE.WebGLRenderer({
    canvas: overlayCanvas,
    alpha: true,
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setSize(width, height);
  renderer.setPixelRatio(dpr);
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  envMap = generateEnvMap(renderer);

  textScene = new THREE.Scene();
  textScene.environment = envMap;

  // ── Lighting: env reflections + a crisp key for specular streaks ──
  const key = new THREE.DirectionalLight(0xffffff, 3.5);
  key.position.set(-0.6, 1.0, 1.2);
  textScene.add(key);

  const rim = new THREE.DirectionalLight(0xffffff, 1.6);
  rim.position.set(1.0, -0.4, 0.6);
  textScene.add(rim);

  textScene.add(new THREE.AmbientLight(0xffffff, 0.55));

  rootGroup = new THREE.Group();
  textScene.add(rootGroup);

  configureCamera(width, height);
  buildText(fontSize, innerWidth - overlayPadding * 2);

  overlayCanvas.style.opacity = '1';
  overlayCanvas.style.pointerEvents = 'none';

  // Hide the HTML headline — the 3D blocks replace it.
  heroElement.style.color = 'transparent';
  heroElement.style.textShadow = 'none';

  // ── Events (listen on the hero element, like the particle version) ──
  heroElement.addEventListener('mouseenter', onHoverStart);
  heroElement.addEventListener('mouseleave', onHoverEnd);
  heroElement.addEventListener('mousemove', onMouseMove);
  heroElement.addEventListener('touchstart', onTouchStart, { passive: true });
  heroElement.addEventListener('touchend', onTouchEnd, { passive: true });
  heroElement.addEventListener('touchmove', onTouchMove, { passive: true });
  window.addEventListener('resize', handleResize);

  isInitialized = true;
  startMorphCycle();
  renderLoop();
}

// ────────────────────────────────────────────────────────
// Morph cycle — 3D card flip between phrases
// ────────────────────────────────────────────────────────

function flipTo(fromMesh, toMesh) {
  const tl = gsap.timeline();
  toMesh.visible = true;
  toMesh.rotation.x = Math.PI / 2;
  toMesh.material.opacity = 0;

  tl.to(fromMesh.rotation, {
    x: -Math.PI / 2,
    duration: TRANSITION_DURATION,
    ease: 'power3.inOut',
  }, 0);
  tl.to(fromMesh.material, {
    opacity: 0,
    duration: TRANSITION_DURATION * 0.6,
    ease: 'power2.in',
    onComplete: () => { fromMesh.visible = false; },
  }, 0);

  tl.to(toMesh.rotation, {
    x: 0,
    duration: TRANSITION_DURATION,
    ease: 'power3.inOut',
  }, 0);
  tl.to(toMesh.material, {
    opacity: 1,
    duration: TRANSITION_DURATION * 0.7,
    ease: 'power2.out',
  }, TRANSITION_DURATION * 0.3);

  return tl;
}

function startMorphCycle() {
  if (phrases.length < 2 || phrases[0] === phrases[1]) return;
  if (morphTimeline) morphTimeline.kill();

  morphTimeline = gsap.timeline({ repeat: -1 });
  morphTimeline
    .add(() => {}, `+=${HOLD_DURATION}`)
    .add(flipTo(meshes[0], meshes[1]))
    .add(() => { activeIndex = 1; })
    .add(() => {}, `+=${HOLD_DURATION}`)
    .add(flipTo(meshes[1], meshes[0]))
    .add(() => { activeIndex = 0; });
}

// ────────────────────────────────────────────────────────
// Render loop
// ────────────────────────────────────────────────────────

const clock = new THREE.Clock();

function renderLoop() {
  if (!isInitialized) return;
  requestAnimationFrame(renderLoop);

  const t = clock.getElapsedTime();

  // Ease the cursor tilt; fall back toward neutral when not hovering.
  const targetX = isHovering ? mouseTiltX : 0;
  const targetY = isHovering ? mouseTiltY : 0;
  smoothTiltX += (targetX - smoothTiltX) * TILT_EASE;
  smoothTiltY += (targetY - smoothTiltY) * TILT_EASE;

  // Gentle constant float keeps the glassy highlights sliding across the edges.
  const idleX = Math.sin(t * IDLE_SPEED_X) * IDLE_AMP_X;
  const idleY = Math.sin(t * IDLE_SPEED_Y) * IDLE_AMP_Y;

  rootGroup.rotation.x = smoothTiltX + idleX;
  rootGroup.rotation.y = smoothTiltY + idleY;

  updateOverlayPosition();
  renderer.render(textScene, camera);
}

// ────────────────────────────────────────────────────────
// Interaction
// ────────────────────────────────────────────────────────

function onHoverStart() {
  isHovering = true;
  if (morphTimeline) morphTimeline.pause();
}

function onHoverEnd() {
  isHovering = false;
  if (morphTimeline) morphTimeline.resume();
}

function setTiltFromClient(clientX, clientY) {
  if (!overlayCanvas) return;
  const r = overlayCanvas.getBoundingClientRect();
  const nx = ((clientX - r.left) / r.width) * 2 - 1;  // -1..1
  const ny = ((clientY - r.top) / r.height) * 2 - 1;
  mouseTiltY = THREE.MathUtils.clamp(nx, -1, 1) * TILT_MAX_Y;
  mouseTiltX = THREE.MathUtils.clamp(ny, -1, 1) * TILT_MAX_X;
}

function onMouseMove(e) {
  setTiltFromClient(e.clientX, e.clientY);
}

function onTouchStart(e) {
  if (e.touches.length === 1) {
    onHoverStart();
    setTiltFromClient(e.touches[0].clientX, e.touches[0].clientY);
  }
}

function onTouchEnd() {
  onHoverEnd();
}

function onTouchMove(e) {
  if (e.touches.length > 0) {
    setTiltFromClient(e.touches[0].clientX, e.touches[0].clientY);
  }
}

// ────────────────────────────────────────────────────────
// Resize
// ────────────────────────────────────────────────────────

function handleResize() {
  if (!isInitialized || !overlayCanvas || !heroElement) return;

  const computed = window.getComputedStyle(heroElement);
  const fontSize = parseFloat(computed.fontSize);
  const [phraseA, phraseB] = phrases;
  const widthA = measureTextWidth(phraseA, fontSize);
  const widthB = measureTextWidth(phraseB, fontSize);
  const sampleWidth = Math.ceil(Math.max(widthA, widthB)) + TEXT_WIDTH_BUFFER;
  const { width, height, innerWidth } = positionOverlay(heroElement, sampleWidth);

  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  configureCamera(width, height);
  buildText(fontSize, innerWidth - overlayPadding * 2);

  // Rebuild invalidated the meshes the timeline drove; restart it.
  startMorphCycle();
}
