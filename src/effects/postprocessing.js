/**
 * postprocessing.js — Effect Composer Setup
 * ──────────────────────────────────────────
 * Uses pmndrs/postprocessing library (NOT Three.js built-in).
 *
 * Effects:
 *   1. Bloom  — white luminance only, no color tinting
 *   2. Noise  — low-intensity film grain for analog texture
 *   3. Vignette — pushes edges to black
 *
 * NO chromatic aberration — it introduces color.
 *
 * All effect intensities are exposed for dat.GUI tweaking.
 */

import {
  EffectComposer,
  EffectPass,
  RenderPass,
  BloomEffect,
  NoiseEffect,
  VignetteEffect,
  BlendFunction,
  KernelSize,
} from 'postprocessing';
import { renderer, setComposer } from '../core/renderer.js';
import { scene } from '../core/scene.js';
import { camera } from '../core/camera.js';

// ── Effect instances (exported for dat.GUI) ──
let bloomEffect;
let noiseEffect;
let vignetteEffect;
let composer;

/**
 * Initialize the post-processing pipeline.
 * Must be called after renderer, scene, and camera are ready.
 */
export function initPostProcessing() {
  composer = new EffectComposer(renderer);

  // Render pass — renders the scene normally first
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  // ── Bloom ──
  // White-only luminance bloom. No color tinting.
  bloomEffect = new BloomEffect({
    blendFunction: BlendFunction.ADD,
    luminanceThreshold: 0.35,   // Catch metallic specular highlights
    luminanceSmoothing: 0.4,    // Smooth transition at threshold edge
    intensity: 1.5,             // Bloom brightness — tunable via GUI
    kernelSize: KernelSize.MEDIUM,
    mipmapBlur: true,           // Smoother, more realistic bloom
  });

  // ── Film Grain (Noise) ──
  // Low intensity for analog texture, not distracting
  noiseEffect = new NoiseEffect({
    blendFunction: BlendFunction.OVERLAY,
    premultiply: true,          // Helps grain sit naturally on dark areas
  });
  // NoiseEffect doesn't take intensity in constructor; set via blendMode
  noiseEffect.blendMode.opacity.value = 0.06;

  // ── Vignette ──
  // Pushes edges to black, focuses attention on center
  vignetteEffect = new VignetteEffect({
    darkness: 0.55,             // Moderate darkness at edges
    offset: 0.3,                // How far from center darkening starts
  });

  // Combine all effects into a single pass for performance
  const effectPass = new EffectPass(camera, bloomEffect, noiseEffect, vignetteEffect);
  composer.addPass(effectPass);

  // Register the composer with the renderer
  setComposer(composer);

  return { bloomEffect, noiseEffect, vignetteEffect, composer };
}

export { bloomEffect, noiseEffect, vignetteEffect };
