/**
 * textParticles.js — Three.js Particle Text Interactive Wave Effect
 * ─────────────────────────────────────────────────────────────
 * Renders the hero text as a GPU-driven particle system on an overlay canvas.
 *
 * The same particle cloud morphs back and forth between two phrases
 * ("Shreyas Sunke" ⇄ "Software Developer"): each particle holds an A-position
 * and a B-position and the `uMorph` uniform cross-dissolves between them on a
 * looping timeline (read one phrase, fade to the other, repeat forever).
 *
 * When the user hovers / touches the text, particles near the cursor locally
 * push away (wave distortion) and the morph loop pauses so the current phrase
 * can be read or selected; releasing resumes the loop.
 */

import * as THREE from 'three';
import gsap from 'gsap';
import { prefersReducedMotion } from '../utils/reducedMotion.js';

// ── Module State ──
let renderer, particleScene, camera, particleMesh;
let overlayCanvas;
let isInitialized = false;
let heroElement = null;
let overlayPadding = 100; // kept in sync so we can reposition on scroll
let overlayCssWidth = 0;  // CSS width of the overlay, used to keep it centered
let phrases = [];         // the two strings the cloud morphs between
let morphTimeline = null; // looping GSAP timeline driving uMorph

// Uniforms object (mutated by GSAP and mouse events)
const uniforms = {
  uHoverState: { value: 0.0 }, 
  uTime:       { value: 0.0 },
  uMouse:      { value: new THREE.Vector2(-999, -999) }, // Pixel coords within canvas
  uResolution: { value: new THREE.Vector2(1, 1) },
  uDPR:        { value: 1.0 },
  uMorph:      { value: 0.0 }, // 0 = phrase A, 1 = phrase B
  uScatter:    { value: 0.0 }, // mid-transition puff distance (set on init)
};

// ── Configuration ──
const RESOLUTION_SCALE = 3;        // Supersample for sub-pixel density (higher = sharper text)
const PARTICLE_SAMPLE_STEP = 1;    // Sample every pixel for high density
const INTERACTION_RADIUS = 80;
const PARTICLE_SIZE_MIN = 0.9;     // sand-grain fine
const PARTICLE_SIZE_MAX = 1.5;
const TEXT_LETTER_SPACING_EM = -0.025; // matches --type-display-lg-ls in CSS
const TEXT_WIDTH_BUFFER = 8;       // px of slack so the final glyph never clips

// ── Morph timing ──
const HOLD_DURATION = 3.0;         // seconds each phrase stays fully readable
const TRANSITION_DURATION = 1.15;  // seconds to cross-dissolve between phrases
const MORPH_SCATTER = 0.28;        // fraction of each particle's random offset puffed mid-transition

// ────────────────────────────────────────────────────────
// GLSL Shaders
// ────────────────────────────────────────────────────────

const vertexShader = /* glsl */ `
  attribute float aSize;
  attribute vec3 aRandomOffset;
  attribute vec3 aPositionB;  // home position for phrase B
  attribute float aAlphaA;    // 1 if this particle belongs to phrase A
  attribute float aAlphaB;    // 1 if this particle belongs to phrase B

  uniform float uHoverState;
  uniform float uTime;
  uniform vec2 uMouse;
  uniform vec2 uResolution;
  uniform float uDPR;
  uniform float uMorph;       // 0 = phrase A, 1 = phrase B
  uniform float uScatter;     // px of mid-transition puff

  varying float vAlpha;
  varying vec3 vColor;

  void main() {
    // ── Morph between the two phrase layouts ──
    // Slide each particle from its A home to its B home, while cross-fading
    // visibility so glyphs that only exist in one phrase fade in/out cleanly.
    vec3 home = mix(position, aPositionB, uMorph);
    float morphAlpha = mix(aAlphaA, aAlphaB, uMorph);

    // Bell curve peaking at the midpoint of the transition (0 at both ends).
    float transition = sin(uMorph * 3.14159265);

    // Organic outward puff so the swap reads as a dissolve, not a rigid slide.
    home.xy += aRandomOffset.xy * transition * uScatter;

    vec3 finalPos = home;

    // ── Interaction Logic ──
    vec2 toParticle = home.xy - uMouse;
    float distToMouse = length(toParticle);
    
    // Smooth falloff based on interaction radius
    float force = 1.0 - smoothstep(0.0, float(${INTERACTION_RADIUS}), distToMouse);
    force *= uHoverState; // Only active when overall hover is active

    if (force > 0.0) {
      vec2 pushDir = normalize(toParticle + vec2(0.001));
      
      // 1. Push away from mouse
      float pushAmount = force * 40.0; // Max push distance
      finalPos.xy += pushDir * pushAmount;
      
      // 2. Add wave/jitter turbulence
      float time = uTime * 3.0;
      finalPos.x += force * sin(time + home.x * 0.05 + home.y * 0.05) * 8.0;
      finalPos.y += force * cos(time + home.y * 0.05) * 8.0;
      finalPos.z += force * aRandomOffset.z * 0.5;
    }

    // Size increases slightly when pushed; shrinks a touch mid-transition.
    float sizeMult = (1.0 + force * 2.0) * (1.0 - transition * 0.25);
    gl_PointSize = aSize * sizeMult * uDPR;

    // ── Lighting gradient ──
    // Anchor the lighting to each particle's text-layout home (not its pushed
    // position) so the gradient stays welded to the letters while they wobble.
    vec2 npos = home.xy / uResolution; // 0..1 across the overlay

    // Soft diagonal base light: brightest toward the upper-left, falling off
    // toward the lower-right, like an off-screen key light.
    float diag = clamp((npos.x * 0.45 + npos.y * 0.75), 0.0, 1.0);
    float baseLight = mix(1.0, 0.66, diag);

    // Specular highlight band that sweeps horizontally across the text on a
    // seamless loop. The wrap makes the gaussian band re-enter from the left.
    float sweepPos = fract(uTime * 0.12);
    float sweepDist = abs(npos.x - sweepPos);
    sweepDist = min(sweepDist, 1.0 - sweepDist);
    float sweep = exp(-sweepDist * sweepDist * 70.0);

    float brightness = clamp(baseLight + sweep * 0.5, 0.0, 1.0);

    // Cool-white base, pure-white in the lit band, with a faint blue bloom
    // riding the moving highlight so it reads as light rather than a color wash.
    vec3 baseColor = vec3(0.80, 0.84, 0.92);
    vec3 color = mix(baseColor, vec3(1.0), brightness);
    color += sweep * vec3(0.10, 0.16, 0.30);

    // ── Color and Alpha ──
    vColor = color;
    vAlpha = morphAlpha;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(finalPos, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  varying float vAlpha;
  varying vec3 vColor;

  void main() {
    // ── Circular point sprite with soft glowing falloff ──
    vec2 center = gl_PointCoord - 0.5;
    float dist = length(center);
    if (dist > 0.5) discard;

    // Solid core to make particles overlap and create continuous shapes
    float alpha = smoothstep(0.5, 0.3, dist);

    // Per-particle lighting gradient (base diagonal light + moving sweep)
    // arrives via vColor; alpha keeps the soft circular sprite falloff.
    gl_FragColor = vec4(vColor, alpha * vAlpha);
  }
`;

// ────────────────────────────────────────────────────────
// Text Sampling
// ────────────────────────────────────────────────────────

/**
 * Measure the rendered width of the hero text using the same font + tracking
 * as the on-screen HTML, so the particle canvas is sized to fit every glyph
 * (otherwise the trailing character gets clipped).
 */
function measureTextWidth(text, fontSize) {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  ctx.font = `600 ${fontSize}px Inter, system-ui, sans-serif`;
  if ('letterSpacing' in ctx) {
    ctx.letterSpacing = `${TEXT_LETTER_SPACING_EM * fontSize}px`;
  }
  return ctx.measureText(text).width;
}

function sampleTextPixels(text, fontSize, maxWidth, maxHeight) {
  const scale = RESOLUTION_SCALE;
  const offscreen = document.createElement('canvas');
  offscreen.width = maxWidth * scale;
  offscreen.height = maxHeight * scale;
  const ctx = offscreen.getContext('2d', { willReadFrequently: true });

  ctx.clearRect(0, 0, maxWidth * scale, maxHeight * scale);
  ctx.font = `600 ${fontSize * scale}px Inter, system-ui, sans-serif`;
  if ('letterSpacing' in ctx) {
    ctx.letterSpacing = `${TEXT_LETTER_SPACING_EM * fontSize * scale}px`;
  }
  ctx.fillStyle = '#FFFFFF';
  ctx.textBaseline = 'top';
  // Center each phrase within the (shared, widest) sample canvas so both
  // phrases morph around the same midpoint.
  ctx.textAlign = 'center';

  const textHeight = fontSize * scale;
  const y = (maxHeight * scale - textHeight) / 2;

  ctx.fillText(text, (maxWidth * scale) / 2, y);

  const imageData = ctx.getImageData(0, 0, maxWidth * scale, maxHeight * scale);
  const pixels = imageData.data;
  const positions = [];

  for (let py = 0; py < maxHeight * scale; py += PARTICLE_SAMPLE_STEP) {
    for (let px = 0; px < maxWidth * scale; px += PARTICLE_SAMPLE_STEP) {
      const index = (py * maxWidth * scale + px) * 4;
      const alpha = pixels[index + 3];

      if (alpha > 128) {
        // Divide by scale to map back to original screen coordinates
        positions.push({ x: px / scale, y: py / scale });
      }
    }
  }

  return positions;
}

// ────────────────────────────────────────────────────────
// Particle System Creation
// ────────────────────────────────────────────────────────

/**
 * Build the particle cloud from TWO phrase layouts.
 *
 * The cloud holds `max(countA, countB)` particles. Each particle is given a
 * home for phrase A (`position`) and a home for phrase B (`aPositionB`).
 * Particles that only exist in one phrase reuse the other phrase's position as
 * a stationary anchor and simply fade in/out (driven by aAlphaA / aAlphaB),
 * so morphing never flings stray particles across the screen.
 */
function createParticleSystem(positionsA, positionsB) {
  const countA = positionsA.length;
  const countB = positionsB.length;
  const count = Math.max(countA, countB);

  const positionArray = new Float32Array(count * 3); // phrase A homes
  const positionBArray = new Float32Array(count * 3); // phrase B homes
  const randomOffsetArray = new Float32Array(count * 3);
  const sizeArray = new Float32Array(count);
  const alphaAArray = new Float32Array(count);
  const alphaBArray = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    const i3 = i * 3;

    const hasA = i < countA;
    const hasB = i < countB;

    // Missing side anchors to the present side so unmatched particles fade
    // in place rather than sliding from off-screen.
    const a = hasA ? positionsA[i] : positionsB[i];
    const b = hasB ? positionsB[i] : positionsA[i];

    positionArray[i3] = a.x;
    positionArray[i3 + 1] = a.y;
    positionArray[i3 + 2] = 0;

    positionBArray[i3] = b.x;
    positionBArray[i3 + 1] = b.y;
    positionBArray[i3 + 2] = 0;

    const angle = Math.random() * Math.PI * 2;
    const distance = 80 * Math.random(); // Fly further
    randomOffsetArray[i3] = Math.cos(angle) * distance;
    randomOffsetArray[i3 + 1] = Math.sin(angle) * distance;
    randomOffsetArray[i3 + 2] = (Math.random() - 0.5) * 80;

    sizeArray[i] = PARTICLE_SIZE_MIN + Math.random() * (PARTICLE_SIZE_MAX - PARTICLE_SIZE_MIN);

    alphaAArray[i] = hasA ? 1.0 : 0.0;
    alphaBArray[i] = hasB ? 1.0 : 0.0;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positionArray, 3));
  geometry.setAttribute('aPositionB', new THREE.BufferAttribute(positionBArray, 3));
  geometry.setAttribute('aRandomOffset', new THREE.BufferAttribute(randomOffsetArray, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizeArray, 1));
  geometry.setAttribute('aAlphaA', new THREE.BufferAttribute(alphaAArray, 1));
  geometry.setAttribute('aAlphaB', new THREE.BufferAttribute(alphaBArray, 1));

  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.NormalBlending,
  });

  return new THREE.Points(geometry, material);
}

/**
 * Sample a single phrase's glyph pixels into particle home positions,
 * offset into the padded overlay space. Shared by init and resize.
 */
function samplePhrasePositions(text, fontSize, sampleWidth, sampleHeight, xPadding, yPadding) {
  const positions = sampleTextPixels(text, fontSize, sampleWidth, sampleHeight);
  for (const pos of positions) {
    pos.x += xPadding;
    pos.y += yPadding;
  }
  return positions;
}

// ────────────────────────────────────────────────────────
// Overlay Canvas Setup
// ────────────────────────────────────────────────────────

function createOverlay() {
  overlayCanvas = document.createElement('canvas');
  overlayCanvas.classList.add('particle-canvas');
  document.body.appendChild(overlayCanvas);
  return overlayCanvas;
}

// Mobile uses the centered hero layout (see the max-width:768px rules in
// main.css). Keep this breakpoint in sync with that CSS.
const MOBILE_BREAKPOINT = 768;

/**
 * Whether the centered (mobile) hero layout is active.
 *
 * NOTE: this is evaluated live off `window.innerWidth` on every call rather
 * than caching a `MediaQueryList`. iOS Safari can report a stale `.matches`
 * on a MediaQueryList that was created at module-load (before the viewport
 * settles) and never given a listener — which made the overlay fall back to
 * the desktop anchor and stick the text to one side on load.
 */
function isMobileLayout() {
  return window.innerWidth <= MOBILE_BREAKPOINT;
}

/**
 * Horizontal centre the overlay should align to.
 * - Mobile (centered hero): the true viewport centre, so both phrases stay
 *   perfectly centered on the device screen regardless of how the char-split
 *   <h1> happens to measure.
 * - Desktop (left-aligned hero): the element's own centre, preserving the
 *   intentional left-of-screen placement.
 */
function overlayAnchorX(rect) {
  if (isMobileLayout()) {
    return window.innerWidth / 2;
  }
  return rect.left + rect.width / 2;
}

function positionOverlay(heroEl, contentWidth) {
  const rect = heroEl.getBoundingClientRect();
  const padding = 100; // vertical room so particles aren't clipped when pushed
  overlayPadding = padding;
  // Use the measured text width when available so the trailing glyph is never
  // clipped by the (potentially narrower) element box.
  const innerWidth = contentWidth != null ? contentWidth : rect.width;

  // Cap the canvas to the viewport width. A fixed canvas wider than the screen
  // is visually clamped by the global `canvas { max-width: 100% }` reset (and
  // on iOS can expand the layout viewport) — both knock the text off-centre and
  // cause the "jump to the side" on load. We instead clamp the width here and
  // recompute the horizontal padding so the glyphs stay centred within whatever
  // width we end up with, and the overlay never overflows the screen.
  const width = Math.min(innerWidth + padding * 2, window.innerWidth);
  const xPadding = (width - innerWidth) / 2; // centres the text inside the canvas

  const height = rect.height + padding * 2;
  overlayCssWidth = width;

  overlayCanvas.width = Math.ceil(width * Math.min(window.devicePixelRatio, 2));
  overlayCanvas.height = Math.ceil(height * Math.min(window.devicePixelRatio, 2));
  overlayCanvas.style.width = `${width}px`;
  overlayCanvas.style.height = `${height}px`;
  overlayCanvas.style.left = `${overlayAnchorX(rect) - width / 2}px`;
  overlayCanvas.style.top = `${rect.top - padding}px`;

  return { width, height, padding, xPadding, rect };
}

/**
 * Keep the fixed-position overlay aligned with the hero text as the page
 * scrolls. The HTML text moves with the document, so the particle canvas must
 * follow it every frame.
 */
function updateOverlayPosition() {
  if (!overlayCanvas || !heroElement) return;
  const rect = heroElement.getBoundingClientRect();
  // Keep the overlay centered on its anchor (see positionOverlay).
  overlayCanvas.style.left = `${overlayAnchorX(rect) - overlayCssWidth / 2}px`;
  overlayCanvas.style.top = `${rect.top - overlayPadding}px`;
}

// ────────────────────────────────────────────────────────
// Initialization
// ────────────────────────────────────────────────────────

export function initTextParticles() {
  if (prefersReducedMotion) return;

  heroElement = document.querySelector('.hero__name');
  if (!heroElement) return;

  createOverlay();

  const computedStyle = window.getComputedStyle(heroElement);
  const fontSize = parseFloat(computedStyle.fontSize);

  // Phrase A is the hero name itself; phrase B is the (now visually hidden)
  // tagline. Read both from the DOM so the markup stays the source of truth.
  const phraseA = heroElement.getAttribute('aria-label') || heroElement.textContent.replace(/\u00a0/g, ' ');
  const taglineEl = document.querySelector('.hero__tagline');
  const phraseB = (taglineEl && taglineEl.textContent.trim()) || phraseA;
  phrases = [phraseA, phraseB];

  // Size the overlay to fit the WIDER of the two phrases so neither clips.
  const widthA = measureTextWidth(phraseA, fontSize);
  const widthB = measureTextWidth(phraseB, fontSize);
  const sampleWidth = Math.ceil(Math.max(widthA, widthB)) + TEXT_WIDTH_BUFFER;
  const { width, height, padding, xPadding } = positionOverlay(heroElement, sampleWidth);

  const sampleHeight = Math.ceil(height - padding * 2);
  const positionsA = samplePhrasePositions(phraseA, fontSize, sampleWidth, sampleHeight, xPadding, padding);
  const positionsB = samplePhrasePositions(phraseB, fontSize, sampleWidth, sampleHeight, xPadding, padding);

  if (positionsA.length === 0 || positionsB.length === 0) return;

  const dpr = Math.min(window.devicePixelRatio, 2);
  renderer = new THREE.WebGLRenderer({
    canvas: overlayCanvas,
    alpha: true,
    antialias: false,
    powerPreference: 'high-performance',
  });
  renderer.setSize(width, height);
  renderer.setPixelRatio(dpr);
  renderer.setClearColor(0x000000, 0);

  camera = new THREE.OrthographicCamera(0, width, 0, height, -1, 1);
  particleScene = new THREE.Scene();

  uniforms.uResolution.value.set(width, height);
  uniforms.uScatter.value = MORPH_SCATTER;
  particleMesh = createParticleSystem(positionsA, positionsB);
  particleScene.add(particleMesh);

  // Particle overlay is always active and visible
  overlayCanvas.style.opacity = '1';
  overlayCanvas.style.pointerEvents = 'none';

  // Hide the HTML text permanently so we only see the particle text
  heroElement.style.color = 'transparent';
  // Also hide the text shadow if any
  heroElement.style.textShadow = 'none';

  // ── Event listeners ──
  heroElement.addEventListener('mouseenter', onHoverStart);
  heroElement.addEventListener('mouseleave', onHoverEnd);
  heroElement.addEventListener('mousemove', onMouseMove);

  // Touch
  heroElement.addEventListener('touchstart', onTouchStart, { passive: true });
  heroElement.addEventListener('touchend', onTouchEnd, { passive: true });
  heroElement.addEventListener('touchmove', onTouchMove, { passive: true });

  window.addEventListener('resize', handleResize);

  isInitialized = true;
  startMorphCycle();
  renderLoop();
}

// ────────────────────────────────────────────────────────
// Morph Cycle
// ────────────────────────────────────────────────────────

/**
 * Loop forever: hold phrase A → dissolve to phrase B → hold B → dissolve back.
 * Hovering / touching the text pauses this timeline (see hover handlers).
 */
function startMorphCycle() {
  if (phrases.length < 2 || phrases[0] === phrases[1]) return;
  if (morphTimeline) morphTimeline.kill();

  uniforms.uMorph.value = 0;
  morphTimeline = gsap.timeline({ repeat: -1 });
  morphTimeline
    .to(uniforms.uMorph, {
      value: 1,
      duration: TRANSITION_DURATION,
      ease: 'power2.inOut',
      delay: HOLD_DURATION,
    })
    .to(uniforms.uMorph, {
      value: 0,
      duration: TRANSITION_DURATION,
      ease: 'power2.inOut',
      delay: HOLD_DURATION,
    });
}

// ────────────────────────────────────────────────────────
// Render Loop
// ────────────────────────────────────────────────────────

const clock = new THREE.Clock();

function renderLoop() {
  if (!isInitialized) return;
  requestAnimationFrame(renderLoop);

  uniforms.uTime.value = clock.getElapsedTime();
  updateOverlayPosition(); // follow the hero text as the page scrolls
  renderer.render(particleScene, camera);
}

// ────────────────────────────────────────────────────────
// Hover Handlers
// ────────────────────────────────────────────────────────

let hoverTween = null;

function onHoverStart(e) {
  // Pause the phrase cycle so the user can read / select the current text
  // for as long as they keep hovering or holding their finger down.
  if (morphTimeline) morphTimeline.pause();

  // Overlay position is kept in sync every frame by updateOverlayPosition(),
  // so we only need to drive the hover state here.
  if (hoverTween) hoverTween.kill();
  hoverTween = gsap.to(uniforms.uHoverState, {
    value: 1.0,
    duration: 0.4,
    ease: 'power2.out',
  });
}

function onHoverEnd(e) {
  // Resume the phrase cycle from wherever it left off.
  if (morphTimeline) morphTimeline.resume();

  if (hoverTween) hoverTween.kill();
  // Move mouse out of bounds so effect stops cleanly
  uniforms.uMouse.value.set(-999, -999);

  hoverTween = gsap.to(uniforms.uHoverState, {
    value: 0.0,
    duration: 0.6,
    ease: 'power2.inOut',
  });
}

function onMouseMove(e) {
  if (!overlayCanvas) return;
  const canvasRect = overlayCanvas.getBoundingClientRect();
  const x = e.clientX - canvasRect.left;
  const y = e.clientY - canvasRect.top;
  uniforms.uMouse.value.set(x, y);
}

function onTouchStart(e) {
  if (e.touches.length === 1) {
    onHoverStart(e);
    onTouchMoveInternal(e.touches[0]);
  }
}

function onTouchEnd(e) {
  onHoverEnd(e);
}

function onTouchMove(e) {
  if (e.touches.length > 0) {
    onTouchMoveInternal(e.touches[0]);
  }
}

function onTouchMoveInternal(touch) {
  if (!overlayCanvas) return;
  const canvasRect = overlayCanvas.getBoundingClientRect();
  const x = touch.clientX - canvasRect.left;
  const y = touch.clientY - canvasRect.top;
  uniforms.uMouse.value.set(x, y);
}

// ────────────────────────────────────────────────────────
// Resize
// ────────────────────────────────────────────────────────

function handleResize() {
  if (!isInitialized || !overlayCanvas || !heroElement) return;

  if (particleMesh) {
    particleScene.remove(particleMesh);
    particleMesh.geometry.dispose();
    particleMesh.material.dispose();
  }

  const computedStyle = window.getComputedStyle(heroElement);
  const fontSize = parseFloat(computedStyle.fontSize);
  const [phraseA, phraseB] = phrases;
  const widthA = measureTextWidth(phraseA, fontSize);
  const widthB = measureTextWidth(phraseB, fontSize);
  const sampleWidth = Math.ceil(Math.max(widthA, widthB)) + TEXT_WIDTH_BUFFER;
  const { width, height, padding, xPadding } = positionOverlay(heroElement, sampleWidth);
  const sampleHeight = Math.ceil(height - padding * 2);
  const positionsA = samplePhrasePositions(phraseA, fontSize, sampleWidth, sampleHeight, xPadding, padding);
  const positionsB = samplePhrasePositions(phraseB, fontSize, sampleWidth, sampleHeight, xPadding, padding);

  if (positionsA.length === 0 || positionsB.length === 0) return;

  renderer.setSize(width, height);
  camera.right = width;
  camera.bottom = height;
  camera.updateProjectionMatrix();

  uniforms.uResolution.value.set(width, height);
  uniforms.uScatter.value = MORPH_SCATTER;
  particleMesh = createParticleSystem(positionsA, positionsB);
  particleScene.add(particleMesh);

  // Rebuild invalidated the geometry the timeline was driving; restart it.
  startMorphCycle();
}
