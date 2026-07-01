/**
 * textParticles.js — Three.js Particle Text Interactive Wave Effect
 * ─────────────────────────────────────────────────────────────
 * Renders hero text as GPU-driven particle overlays on separate canvases:
 *
 *   • Name  — static "Shreyas Sunke", white particles, hover diversion only
 *   • Subhead — rotating roles (Builder → Strategist → Operator), gray
 *               particles with morph + hover diversion
 *
 * When the user hovers / touches either line, particles near the cursor push
 * away (wave distortion). On the subhead, hovering also pauses the rotation.
 */

import * as THREE from 'three';
import gsap from 'gsap';
import { prefersReducedMotion } from '../utils/reducedMotion.js';

// ── Configuration ──
const RESOLUTION_SCALE = 3;
const PARTICLE_SAMPLE_STEP = 1;
const INTERACTION_RADIUS = 80;
const PARTICLE_SIZE_MIN = 0.9;
const PARTICLE_SIZE_MAX = 1.5;
const TEXT_WIDTH_BUFFER = 8;
const MOBILE_BREAKPOINT = 768;

const HOLD_DURATION = 3.0;
const TRANSITION_DURATION = 1.15;
const MORPH_SCATTER = 0.28;

const COLOR_PRESETS = {
  primary: {
    base: [0.80, 0.84, 0.92],
    highlight: [1.0, 1.0, 1.0],
    sweep: [0.10, 0.16, 0.30],
  },
  subhead: {
    base: [0.55, 0.55, 0.55],
    highlight: [0.72, 0.72, 0.74],
    sweep: [0.05, 0.05, 0.07],
  },
};

// ── GLSL Shaders ──

const vertexShader = /* glsl */ `
  attribute float aSize;
  attribute vec3 aRandomOffset;
  attribute vec3 aPositionB;
  attribute float aAlphaA;
  attribute float aAlphaB;

  uniform float uHoverState;
  uniform float uTime;
  uniform vec2 uMouse;
  uniform vec2 uResolution;
  uniform float uDPR;
  uniform float uMorph;
  uniform float uScatter;
  uniform vec3 uBaseColor;
  uniform vec3 uHighlightColor;
  uniform vec3 uSweepTint;

  varying float vAlpha;
  varying vec3 vColor;

  void main() {
    vec3 home = mix(position, aPositionB, uMorph);
    float morphAlpha = mix(aAlphaA, aAlphaB, uMorph);

    float transition = sin(uMorph * 3.14159265);
    home.xy += aRandomOffset.xy * transition * uScatter;

    vec3 finalPos = home;

    vec2 toParticle = home.xy - uMouse;
    float distToMouse = length(toParticle);
    float force = 1.0 - smoothstep(0.0, float(${INTERACTION_RADIUS}), distToMouse);
    force *= uHoverState;

    if (force > 0.0) {
      vec2 pushDir = normalize(toParticle + vec2(0.001));
      float pushAmount = force * 40.0;
      finalPos.xy += pushDir * pushAmount;

      float time = uTime * 3.0;
      finalPos.x += force * sin(time + home.x * 0.05 + home.y * 0.05) * 8.0;
      finalPos.y += force * cos(time + home.y * 0.05) * 8.0;
      finalPos.z += force * aRandomOffset.z * 0.5;
    }

    float sizeMult = (1.0 + force * 2.0) * (1.0 - transition * 0.25);
    gl_PointSize = aSize * sizeMult * uDPR;

    vec2 npos = home.xy / uResolution;
    float diag = clamp((npos.x * 0.45 + npos.y * 0.75), 0.0, 1.0);
    float baseLight = mix(1.0, 0.66, diag);

    float sweepPos = fract(uTime * 0.12);
    float sweepDist = abs(npos.x - sweepPos);
    sweepDist = min(sweepDist, 1.0 - sweepDist);
    float sweep = exp(-sweepDist * sweepDist * 70.0);

    float brightness = clamp(baseLight + sweep * 0.5, 0.0, 1.0);
    vec3 color = mix(uBaseColor, uHighlightColor, brightness);
    color += sweep * uSweepTint;

    vColor = color;
    vAlpha = morphAlpha;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(finalPos, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  varying float vAlpha;
  varying vec3 vColor;

  void main() {
    vec2 center = gl_PointCoord - 0.5;
    float dist = length(center);
    if (dist > 0.5) discard;

    float alpha = smoothstep(0.5, 0.3, dist);
    gl_FragColor = vec4(vColor, alpha * vAlpha);
  }
`;

// ── Layer factory ──

function createUniforms(preset) {
  const colors = COLOR_PRESETS[preset];
  return {
    uHoverState: { value: 0.0 },
    uTime: { value: 0.0 },
    uMouse: { value: new THREE.Vector2(-999, -999) },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uDPR: { value: 1.0 },
    uMorph: { value: 0.0 },
    uScatter: { value: 0.0 },
    uBaseColor: { value: new THREE.Vector3(...colors.base) },
    uHighlightColor: { value: new THREE.Vector3(...colors.highlight) },
    uSweepTint: { value: new THREE.Vector3(...colors.sweep) },
  };
}

function createLayer(preset, morphEnabled) {
  return {
    renderer: null,
    scene: null,
    camera: null,
    mesh: null,
    canvas: null,
    element: null,
    uniforms: createUniforms(preset),
    overlayPadding: 100,
    overlayCssWidth: 0,
    overlayXPadding: 0,
    words: [],
    currentIndex: 0,
    morphTween: null,
    hoverTween: null,
    morphEnabled,
    initialized: false,
    metrics: { letterSpacingEm: -0.025, fontWeight: '500' },
  };
}

const subheadLayer = createLayer('subhead', true);
const nameLayer = createLayer('primary', false);
const clock = new THREE.Clock();
let renderLoopRunning = false;

// ── Layout helpers ──

function isMobileLayout() {
  return window.innerWidth <= MOBILE_BREAKPOINT;
}

function overlayLeft(rect, canvasWidth, xPadding) {
  if (isMobileLayout()) {
    return window.innerWidth / 2 - canvasWidth / 2;
  }
  return rect.left - xPadding;
}

function syncMetrics(layer) {
  const cs = window.getComputedStyle(layer.element);
  const ls = parseFloat(cs.letterSpacing);
  const fs = parseFloat(cs.fontSize);
  if (!Number.isNaN(ls) && fs > 0) {
    layer.metrics.letterSpacingEm = ls / fs;
  }
  layer.metrics.fontWeight = cs.fontWeight || '500';
}

// ── Text sampling ──

function measureTextWidth(text, fontSize, metrics) {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  ctx.font = `${metrics.fontWeight} ${fontSize}px Inter, system-ui, sans-serif`;
  if ('letterSpacing' in ctx) {
    ctx.letterSpacing = `${metrics.letterSpacingEm * fontSize}px`;
  }
  return ctx.measureText(text).width;
}

function sampleTextPixels(text, fontSize, maxWidth, maxHeight, metrics) {
  const scale = RESOLUTION_SCALE;
  const offscreen = document.createElement('canvas');
  offscreen.width = maxWidth * scale;
  offscreen.height = maxHeight * scale;
  const ctx = offscreen.getContext('2d', { willReadFrequently: true });

  ctx.clearRect(0, 0, maxWidth * scale, maxHeight * scale);
  ctx.font = `${metrics.fontWeight} ${fontSize * scale}px Inter, system-ui, sans-serif`;
  if ('letterSpacing' in ctx) {
    ctx.letterSpacing = `${metrics.letterSpacingEm * fontSize * scale}px`;
  }
  ctx.fillStyle = '#FFFFFF';
  ctx.textBaseline = 'top';

  const textHeight = fontSize * scale;
  const y = (maxHeight * scale - textHeight) / 2;

  if (isMobileLayout()) {
    ctx.textAlign = 'center';
    ctx.fillText(text, (maxWidth * scale) / 2, y);
  } else {
    ctx.textAlign = 'left';
    ctx.fillText(text, 0, y);
  }

  const imageData = ctx.getImageData(0, 0, maxWidth * scale, maxHeight * scale);
  const pixels = imageData.data;
  const positions = [];

  for (let py = 0; py < maxHeight * scale; py += PARTICLE_SAMPLE_STEP) {
    for (let px = 0; px < maxWidth * scale; px += PARTICLE_SAMPLE_STEP) {
      const index = (py * maxWidth * scale + px) * 4;
      if (pixels[index + 3] > 128) {
        positions.push({ x: px / scale, y: py / scale });
      }
    }
  }

  return positions;
}

function samplePhrasePositions(text, fontSize, sampleWidth, sampleHeight, xPadding, yPadding, metrics) {
  const positions = sampleTextPixels(text, fontSize, sampleWidth, sampleHeight, metrics);
  for (const pos of positions) {
    pos.x += xPadding;
    pos.y += yPadding;
  }
  return positions;
}

function createParticleSystem(positionsA, positionsB, uniforms) {
  const countA = positionsA.length;
  const countB = positionsB.length;
  const count = Math.max(countA, countB);

  const positionArray = new Float32Array(count * 3);
  const positionBArray = new Float32Array(count * 3);
  const randomOffsetArray = new Float32Array(count * 3);
  const sizeArray = new Float32Array(count);
  const alphaAArray = new Float32Array(count);
  const alphaBArray = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    const i3 = i * 3;
    const hasA = i < countA;
    const hasB = i < countB;
    const a = hasA ? positionsA[i] : positionsB[i];
    const b = hasB ? positionsB[i] : positionsA[i];

    positionArray[i3] = a.x;
    positionArray[i3 + 1] = a.y;
    positionArray[i3 + 2] = 0;

    positionBArray[i3] = b.x;
    positionBArray[i3 + 1] = b.y;
    positionBArray[i3 + 2] = 0;

    const angle = Math.random() * Math.PI * 2;
    const distance = 80 * Math.random();
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

function positionOverlay(layer, contentWidth) {
  const rect = layer.element.getBoundingClientRect();
  const padding = 100;
  layer.overlayPadding = padding;
  const innerWidth = contentWidth != null ? contentWidth : rect.width;

  const width = Math.min(innerWidth + padding * 2, window.innerWidth);
  const xPadding = (width - innerWidth) / 2;
  layer.overlayXPadding = xPadding;

  const height = rect.height + padding * 2;
  layer.overlayCssWidth = width;

  layer.canvas.width = Math.ceil(width * Math.min(window.devicePixelRatio, 2));
  layer.canvas.height = Math.ceil(height * Math.min(window.devicePixelRatio, 2));
  layer.canvas.style.width = `${width}px`;
  layer.canvas.style.height = `${height}px`;
  layer.canvas.style.left = `${overlayLeft(rect, width, xPadding)}px`;
  layer.canvas.style.top = `${rect.top - padding}px`;

  return { width, height, padding, xPadding, rect };
}

function updateOverlayPosition(layer) {
  if (!layer.canvas || !layer.element) return;
  const rect = layer.element.getBoundingClientRect();
  layer.canvas.style.left = `${overlayLeft(rect, layer.overlayCssWidth, layer.overlayXPadding)}px`;
  layer.canvas.style.top = `${rect.top - layer.overlayPadding}px`;
}

function disposeMesh(layer) {
  if (!layer.mesh) return;
  layer.scene.remove(layer.mesh);
  layer.mesh.geometry.dispose();
  layer.mesh.material.dispose();
  layer.mesh = null;
}

function buildParticlesForPair(layer, indexA, indexB) {
  const computedStyle = window.getComputedStyle(layer.element);
  const fontSize = parseFloat(computedStyle.fontSize);
  const wordA = layer.words[indexA];
  const wordB = layer.words[indexB];

  const widestWord = Math.max(...layer.words.map((w) => measureTextWidth(w, fontSize, layer.metrics)));
  const sampleWidth = Math.ceil(widestWord) + TEXT_WIDTH_BUFFER;
  const layout = positionOverlay(layer, sampleWidth);
  const { width, height, padding, xPadding } = layout;

  const sampleHeight = Math.ceil(height - padding * 2);
  const positionsA = samplePhrasePositions(wordA, fontSize, sampleWidth, sampleHeight, xPadding, padding, layer.metrics);
  const positionsB = samplePhrasePositions(wordB, fontSize, sampleWidth, sampleHeight, xPadding, padding, layer.metrics);

  if (positionsA.length === 0 || positionsB.length === 0) return null;

  disposeMesh(layer);

  layer.uniforms.uResolution.value.set(width, height);
  layer.uniforms.uScatter.value = MORPH_SCATTER;
  layer.uniforms.uMorph.value = 0;

  layer.mesh = createParticleSystem(positionsA, positionsB, layer.uniforms);
  layer.scene.add(layer.mesh);

  return layout;
}

function readSubheadWords(element) {
  const attr = element.getAttribute('data-words');
  if (attr) {
    return attr.split(',').map((w) => w.trim()).filter(Boolean);
  }
  const label = element.getAttribute('aria-label');
  if (label) {
    return label.split(',').map((w) => w.trim()).filter(Boolean);
  }
  return [element.textContent.trim()];
}

function readNamePhrase(element) {
  const label = element.getAttribute('aria-label');
  if (label) return [label.trim()];
  return [element.textContent.replace(/\u00a0/g, ' ').trim()];
}

// ── Morph cycle (subhead only) ──

function startMorphCycle(layer) {
  if (!layer.morphEnabled || layer.words.length < 2) return;
  if (layer.morphTween) layer.morphTween.kill();
  layer.uniforms.uMorph.value = 0;
  scheduleNextMorph(layer);
}

function scheduleNextMorph(layer) {
  layer.morphTween = gsap.to(layer.uniforms.uMorph, {
    value: 1,
    duration: TRANSITION_DURATION,
    ease: 'power2.inOut',
    delay: HOLD_DURATION,
    onComplete: () => {
      if (!layer.initialized) return;
      layer.currentIndex = (layer.currentIndex + 1) % layer.words.length;
      const nextIndex = (layer.currentIndex + 1) % layer.words.length;
      buildParticlesForPair(layer, layer.currentIndex, nextIndex);
      scheduleNextMorph(layer);
    },
  });
}

// ── Hover handlers ──

function bindHoverEvents(layer) {
  const onHoverStart = () => {
    if (layer.morphEnabled && layer.morphTween) layer.morphTween.pause();
    if (layer.hoverTween) layer.hoverTween.kill();
    layer.hoverTween = gsap.to(layer.uniforms.uHoverState, {
      value: 1.0,
      duration: 0.4,
      ease: 'power2.out',
    });
  };

  const onHoverEnd = () => {
    if (layer.morphEnabled && layer.morphTween) layer.morphTween.resume();
    if (layer.hoverTween) layer.hoverTween.kill();
    layer.uniforms.uMouse.value.set(-999, -999);
    layer.hoverTween = gsap.to(layer.uniforms.uHoverState, {
      value: 0.0,
      duration: 0.6,
      ease: 'power2.inOut',
    });
  };

  const setMouseFromEvent = (clientX, clientY) => {
    if (!layer.canvas) return;
    const canvasRect = layer.canvas.getBoundingClientRect();
    layer.uniforms.uMouse.value.set(clientX - canvasRect.left, clientY - canvasRect.top);
  };

  layer.element.addEventListener('mouseenter', onHoverStart);
  layer.element.addEventListener('mouseleave', onHoverEnd);
  layer.element.addEventListener('mousemove', (e) => setMouseFromEvent(e.clientX, e.clientY));
  layer.element.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) {
      onHoverStart();
      setMouseFromEvent(e.touches[0].clientX, e.touches[0].clientY);
    }
  }, { passive: true });
  layer.element.addEventListener('touchend', onHoverEnd, { passive: true });
  layer.element.addEventListener('touchmove', (e) => {
    if (e.touches.length > 0) {
      setMouseFromEvent(e.touches[0].clientX, e.touches[0].clientY);
    }
  }, { passive: true });
}

function handleLayerResize(layer) {
  if (!layer.initialized || !layer.canvas || !layer.element) return;
  syncMetrics(layer);
  const nextIndex = (layer.currentIndex + 1) % layer.words.length;
  const layout = buildParticlesForPair(layer, layer.currentIndex, nextIndex);
  if (!layout) return;

  layer.renderer.setSize(layout.width, layout.height);
  layer.camera.right = layout.width;
  layer.camera.bottom = layout.height;
  layer.camera.updateProjectionMatrix();

  if (layer.morphEnabled) startMorphCycle(layer);
}

function onWindowResize() {
  handleLayerResize(subheadLayer);
  handleLayerResize(nameLayer);
}

// ── Render loop ──

function renderLayer(layer, time) {
  if (!layer.initialized) return;
  layer.uniforms.uTime.value = time;
  updateOverlayPosition(layer);
  layer.renderer.render(layer.scene, layer.camera);
}

function renderLoop() {
  requestAnimationFrame(renderLoop);
  const time = clock.getElapsedTime();
  renderLayer(nameLayer, time);
  renderLayer(subheadLayer, time);
}

function ensureRenderLoop() {
  if (!renderLoopRunning) {
    renderLoopRunning = true;
    renderLoop();
  }
}

// ── Layer init ──

function initParticleLayer(layer, selector, readWords) {
  if (layer.initialized) return;

  layer.element = document.querySelector(selector);
  if (!layer.element) return;

  layer.words = readWords(layer.element);
  if (layer.words.length === 0) return;
  layer.currentIndex = 0;

  layer.canvas = document.createElement('canvas');
  layer.canvas.classList.add('particle-canvas');
  document.body.appendChild(layer.canvas);

  syncMetrics(layer);

  const dpr = Math.min(window.devicePixelRatio, 2);
  layer.renderer = new THREE.WebGLRenderer({
    canvas: layer.canvas,
    alpha: true,
    antialias: false,
    powerPreference: 'high-performance',
  });
  layer.renderer.setPixelRatio(dpr);
  layer.renderer.setClearColor(0x000000, 0);

  layer.scene = new THREE.Scene();
  layer.camera = new THREE.OrthographicCamera(0, 1, 0, 1, -1, 1);

  const nextIndex = (layer.currentIndex + 1) % layer.words.length;
  const layout = buildParticlesForPair(layer, layer.currentIndex, nextIndex);
  if (!layout) return;

  layer.renderer.setSize(layout.width, layout.height);
  layer.camera.right = layout.width;
  layer.camera.bottom = layout.height;
  layer.camera.updateProjectionMatrix();

  layer.canvas.style.opacity = '1';
  layer.canvas.style.pointerEvents = 'none';

  layer.element.style.color = 'transparent';
  layer.element.style.textShadow = 'none';
  layer.element.style.opacity = '1';

  bindHoverEvents(layer);

  if (!window.__particleResizeBound) {
    window.addEventListener('resize', onWindowResize);
    window.__particleResizeBound = true;
  }

  layer.initialized = true;
  if (layer.morphEnabled) startMorphCycle(layer);
  ensureRenderLoop();
}

/** Rotating role subheading — Builder → Strategist → Operator */
export function initTextParticles() {
  if (prefersReducedMotion) return;
  initParticleLayer(subheadLayer, '.hero__subhead', readSubheadWords);
}

/** Static hero name — hover diversion only, no morph */
export function initHeroNameParticles() {
  if (prefersReducedMotion) return;
  initParticleLayer(nameLayer, '.hero__name', readNamePhrase);
}
