/**
 * debug.js — dat.GUI Debug Panel
 * ───────────────────────────────
 * Real-time tweaking of visual parameters during development.
 * Controls: bloom intensity, rotation speed, grain intensity,
 *           wireframe opacity, light orbit speed.
 *
 * Only active in development builds.
 */

import * as dat from 'dat.gui';
import { heroParams } from '../scenes/hero.js';

let gui = null;

/**
 * Initialize the debug panel.
 * @param {object} effects - { bloomEffect, noiseEffect, vignetteEffect }
 */
export function initDebug(effects) {
  const { bloomEffect, noiseEffect, vignetteEffect } = effects;

  gui = new dat.GUI({ width: 300 });
  gui.domElement.style.zIndex = '999';

  // ── Bloom Controls ──
  const bloomFolder = gui.addFolder('Bloom');
  bloomFolder.add(bloomEffect, 'intensity', 0, 3, 0.01).name('Intensity');
  bloomFolder.add(bloomEffect.luminanceMaterial, 'threshold', 0, 1, 0.01).name('Threshold');
  bloomFolder.add(bloomEffect.luminanceMaterial, 'smoothing', 0, 1, 0.01).name('Smoothing');
  bloomFolder.open();

  // ── Film Grain Controls ──
  const grainFolder = gui.addFolder('Film Grain');
  grainFolder.add(noiseEffect.blendMode.opacity, 'value', 0, 0.2, 0.005).name('Intensity');
  grainFolder.open();

  // ── Vignette Controls ──
  const vignetteFolder = gui.addFolder('Vignette');
  vignetteFolder.add(vignetteEffect, 'darkness', 0, 1, 0.01).name('Darkness');
  vignetteFolder.add(vignetteEffect, 'offset', 0, 1, 0.01).name('Offset');

  // ── Hero Object Controls ──
  const heroFolder = gui.addFolder('Hero Object');
  heroFolder.add(heroParams, 'rotationSpeed', 0, 0.01, 0.0001).name('Rotation Speed');
  heroFolder.add(heroParams, 'wireframeOpacity', 0, 1, 0.01).name('Wireframe Opacity');
  heroFolder.add(heroParams, 'lightOrbitSpeed', 0, 0.05, 0.001).name('Light Orbit Speed');
  heroFolder.add(heroParams, 'lightIntensity', 0, 5, 0.1).name('Light Intensity');
  heroFolder.add(heroParams, 'cursorInfluence', 0, 2, 0.05).name('Cursor Influence');
  heroFolder.add(heroParams, 'lerpFactor', 0.01, 0.2, 0.005).name('Lerp Smoothing');
  heroFolder.open();

  return gui;
}

/**
 * Destroy the debug panel.
 */
export function destroyDebug() {
  if (gui) {
    gui.destroy();
    gui = null;
  }
}
