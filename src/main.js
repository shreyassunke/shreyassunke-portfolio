/**
 * main.js — Application Entry Point
 * ──────────────────────────────────
 * Orchestrates initialization of all systems in the correct order.
 * This is the single entry point — everything flows from here.
 *
 * Initialization order:
 *   1. Styles
 *   2. Reduced motion detection
 *   3. Lenis + ScrollTrigger bridge
 *   4. Three.js Scene, Camera, Renderer
 *   5. Post-processing composer
 *   6. NASA Starfield background (skybox + particles)
 *   7. Hero scene (icosahedron, light, cursor tracking)
 *   8. Hero text animation
 *   9. Scroll-driven camera
 *  10. Debug panel (dev only)
 *  11. Start the single render loop
 */

// ── 1. Styles ──
import './styles/reset.css';
import './styles/variables.css';
import './styles/main.css';

// ── 2. Reduced Motion ──
import './utils/reducedMotion.js';

// ── 3. Smooth Scroll ──
import { initScroll } from './core/scroll.js';

// ── 4. Three.js Core ──
// These are imported for their side effects (scene, camera, renderer creation)
import './core/scene.js';
import './core/camera.js';
import { startRenderLoop } from './core/renderer.js';

// ── 5. Post-Processing ──
import { initPostProcessing } from './effects/postprocessing.js';

// ── 6. NASA Starfield ──
import { initStarfield, setHeroRef } from './scenes/starfield.js';

// ── 7. Hero Scene ──
import { initHero, heroGroup } from './scenes/hero.js';

// ── 8. Hero Text Animation ──
import { initHeroText } from './animations/heroText.js';

// ── 9. Scroll Camera ──
import { initScrollCamera } from './animations/scrollCamera.js';

// ── 9.5. Hover Glow Effect ──
import { initHoverGlow } from './animations/hoverGlow.js';

// ── 10. Debug Panel ──
import { initDebug } from './utils/debug.js';

// ─────────────────────────────────────────
// Boot sequence
// ─────────────────────────────────────────
function init() {
  // Smooth scrolling (Lenis → GSAP ScrollTrigger)
  initScroll();

  // Post-processing pipeline (bloom, grain, vignette)
  const effects = initPostProcessing();

  // NASA starfield background (skybox sphere + particle stars)
  // Initialized before hero so it renders behind the icosahedron
  initStarfield();

  // Hero 3D scene (icosahedron + wireframe + orbiting light)
  initHero();

  // Connect hero group to starfield for rotation coupling
  setHeroRef(heroGroup);

  // Hero text character-split stagger animation
  initHeroText();

  // Scroll-driven camera movement between sections
  initScrollCamera();

  // Mouse hover border illuminance tracking
  initHoverGlow();

  // Debug panel (dat.GUI) — comment out for production
  if (effects) {
    initDebug(effects);
  }

  // ── 11. Start the single render loop ──
  startRenderLoop();

  console.log(
    '%c[Portfolio] All systems initialized.',
    'color: #888; font-family: monospace;'
  );
}

// Wait for DOM to be ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

