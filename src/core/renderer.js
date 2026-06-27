/**
 * renderer.js — The Single Render Loop
 * ──────────────────────────────────────
 * THIS is the only requestAnimationFrame in the entire app.
 * All animation callbacks register via onTick().
 *
 * Uses the `postprocessing` library's EffectComposer
 * (NOT Three.js's built-in EffectComposer).
 */

import * as THREE from 'three';
import { EffectComposer } from 'postprocessing';
import { scene } from './scene.js';
import { camera, updateCameraAspect } from './camera.js';

// ── Renderer ──
const canvas = document.getElementById('webgl');
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: false,
  powerPreference: 'high-performance',
});

renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // Cap at 2x for perf
renderer.toneMapping = THREE.NoToneMapping; // No color shift
renderer.outputColorSpace = THREE.SRGBColorSpace;

// ── Effect Composer ──
// Will be set up by postprocessing.js after effects are created
let composer = null;

export function setComposer(effectComposer) {
  composer = effectComposer;
}

// ── Tick System ──
// All animation callbacks register here — NO other rAF calls allowed
const tickCallbacks = [];

/**
 * Register a callback to be called every frame.
 * @param {function} callback - Receives (elapsedTime, deltaTime)
 */
export function onTick(callback) {
  tickCallbacks.push(callback);
}

/**
 * Unregister a tick callback.
 * @param {function} callback
 */
export function offTick(callback) {
  const index = tickCallbacks.indexOf(callback);
  if (index > -1) tickCallbacks.splice(index, 1);
}

// ── Clock ──
const clock = new THREE.Clock();

// ── The Single Render Loop ──
function tick() {
  requestAnimationFrame(tick);

  const elapsedTime = clock.getElapsedTime();
  const deltaTime = clock.getDelta();

  // Execute all registered tick callbacks
  for (let i = 0; i < tickCallbacks.length; i++) {
    tickCallbacks[i](elapsedTime, deltaTime);
  }

  // Render via composer (with post-processing) or fallback to raw renderer
  if (composer) {
    composer.render(deltaTime);
  } else {
    renderer.render(scene, camera);
  }
}

// ── Resize Handler ──
function onResize() {
  const width = window.innerWidth;
  const height = window.innerHeight;

  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  updateCameraAspect();

  if (composer) {
    composer.setSize(width, height);
  }
}

window.addEventListener('resize', onResize);

/**
 * Start the render loop. Call once from main.js.
 */
export function startRenderLoop() {
  tick();
}

export { renderer, canvas };
