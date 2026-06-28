/**
 * textParticles.js — Three.js Particle Text Interactive Wave Effect
 * ─────────────────────────────────────────────────────────────
 * Renders the hero text as a GPU-driven particle system on an overlay canvas.
 * When the user hovers over the text, particles near the mouse cursor
 * locally push away (wave distortion) and spring back.
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

// Uniforms object (mutated by GSAP and mouse events)
const uniforms = {
  uHoverState: { value: 0.0 }, 
  uTime:       { value: 0.0 },
  uMouse:      { value: new THREE.Vector2(-999, -999) }, // Pixel coords within canvas
  uResolution: { value: new THREE.Vector2(1, 1) },
  uDPR:        { value: 1.0 },
};

// ── Configuration ──
const RESOLUTION_SCALE = 3;        // Supersample for sub-pixel density (higher = sharper text)
const PARTICLE_SAMPLE_STEP = 1;    // Sample every pixel for high density
const INTERACTION_RADIUS = 80;
const PARTICLE_SIZE_MIN = 0.9;     // sand-grain fine
const PARTICLE_SIZE_MAX = 1.5;
const TEXT_LETTER_SPACING_EM = -0.025; // matches --type-display-lg-ls in CSS
const TEXT_WIDTH_BUFFER = 8;       // px of slack so the final glyph never clips

// ────────────────────────────────────────────────────────
// GLSL Shaders
// ────────────────────────────────────────────────────────

const vertexShader = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aRandomOffset;

  uniform float uHoverState;
  uniform float uTime;
  uniform vec2 uMouse;
  uniform vec2 uResolution;
  uniform float uDPR;

  varying float vAlpha;
  varying vec3 vColor;

  void main() {
    // Home position (text glyph location)
    vec3 home = position;
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

    // Size increases slightly when pushed
    float sizeMult = 1.0 + force * 2.0;
    gl_PointSize = aSize * sizeMult * uDPR;

    // ── Color and Alpha ──
    vColor = vec3(1.0, 1.0, 1.0); // Pure white text
    
    // Always fully visible (since the particles ARE the text)
    vAlpha = aAlpha;

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

    // Keep it pure white, brightness can be driven by vColor
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
  ctx.textAlign = 'left';

  const textHeight = fontSize * scale;
  const y = (maxHeight * scale - textHeight) / 2;

  ctx.fillText(text, 0, y);

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

function createParticleSystem(positions) {
  const count = positions.length;

  const positionArray = new Float32Array(count * 3);
  const randomOffsetArray = new Float32Array(count * 3);
  const sizeArray = new Float32Array(count);
  const alphaArray = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    const i3 = i * 3;

    positionArray[i3] = positions[i].x;
    positionArray[i3 + 1] = positions[i].y;
    positionArray[i3 + 2] = 0;

    const angle = Math.random() * Math.PI * 2;
    const distance = 80 * Math.random(); // Fly further
    randomOffsetArray[i3] = Math.cos(angle) * distance;
    randomOffsetArray[i3 + 1] = Math.sin(angle) * distance;
    randomOffsetArray[i3 + 2] = (Math.random() - 0.5) * 80;

    sizeArray[i] = PARTICLE_SIZE_MIN + Math.random() * (PARTICLE_SIZE_MAX - PARTICLE_SIZE_MIN);
    // Make alpha 1.0 so the text looks completely solid
    alphaArray[i] = 1.0;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positionArray, 3));
  geometry.setAttribute('aRandomOffset', new THREE.BufferAttribute(randomOffsetArray, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizeArray, 1));
  geometry.setAttribute('aAlpha', new THREE.BufferAttribute(alphaArray, 1));

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

// ────────────────────────────────────────────────────────
// Overlay Canvas Setup
// ────────────────────────────────────────────────────────

function createOverlay() {
  overlayCanvas = document.createElement('canvas');
  overlayCanvas.classList.add('particle-canvas');
  document.body.appendChild(overlayCanvas);
  return overlayCanvas;
}

function positionOverlay(heroEl, contentWidth) {
  const rect = heroEl.getBoundingClientRect();
  const padding = 100; // Need padding so particles don't clip when pushed
  overlayPadding = padding;
  // Use the measured text width when available so the trailing glyph is never
  // clipped by the (potentially narrower) element box.
  const innerWidth = contentWidth != null ? contentWidth : rect.width;
  const width = innerWidth + padding * 2;
  const height = rect.height + padding * 2;

  overlayCanvas.width = Math.ceil(width * Math.min(window.devicePixelRatio, 2));
  overlayCanvas.height = Math.ceil(height * Math.min(window.devicePixelRatio, 2));
  overlayCanvas.style.width = `${width}px`;
  overlayCanvas.style.height = `${height}px`;
  overlayCanvas.style.left = `${rect.left - padding}px`;
  overlayCanvas.style.top = `${rect.top - padding}px`;

  return { width, height, padding, rect };
}

/**
 * Keep the fixed-position overlay aligned with the hero text as the page
 * scrolls. The HTML text moves with the document, so the particle canvas must
 * follow it every frame.
 */
function updateOverlayPosition() {
  if (!overlayCanvas || !heroElement) return;
  const rect = heroElement.getBoundingClientRect();
  overlayCanvas.style.left = `${rect.left - overlayPadding}px`;
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
  const text = heroElement.getAttribute('aria-label') || heroElement.textContent.replace(/\u00a0/g, ' ');

  const sampleWidth = Math.ceil(measureTextWidth(text, fontSize)) + TEXT_WIDTH_BUFFER;
  const { width, height, padding } = positionOverlay(heroElement, sampleWidth);

  const sampleHeight = Math.ceil(height - padding * 2);
  const positions = sampleTextPixels(text, fontSize, sampleWidth, sampleHeight);

  if (positions.length === 0) return;

  for (const pos of positions) {
    pos.x += padding;
    pos.y += padding;
  }

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
  particleMesh = createParticleSystem(positions);
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
  renderLoop();
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
  const text = heroElement.getAttribute('aria-label') || heroElement.textContent.replace(/\u00a0/g, ' ');
  const sampleWidth = Math.ceil(measureTextWidth(text, fontSize)) + TEXT_WIDTH_BUFFER;
  const { width, height, padding } = positionOverlay(heroElement, sampleWidth);
  const sampleHeight = Math.ceil(height - padding * 2);
  const positions = sampleTextPixels(text, fontSize, sampleWidth, sampleHeight);

  if (positions.length === 0) return;

  for (const pos of positions) {
    pos.x += padding;
    pos.y += padding;
  }

  renderer.setSize(width, height);
  camera.right = width;
  camera.bottom = height;
  camera.updateProjectionMatrix();

  uniforms.uResolution.value.set(width, height);
  particleMesh = createParticleSystem(positions);
  particleScene.add(particleMesh);
}
