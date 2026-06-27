/**
 * scroll.js — Lenis → GSAP ScrollTrigger Bridge
 * ────────────────────────────────────────────────
 * Lenis provides smooth scroll. Its RAF is driven by the main
 * render loop (no secondary requestAnimationFrame).
 * On each scroll tick, GSAP ScrollTrigger is updated.
 *
 * If prefers-reduced-motion is active, Lenis is disabled
 * and native scroll is used.
 */

import Lenis from 'lenis';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { prefersReducedMotion } from '../utils/reducedMotion.js';

// Register ScrollTrigger with GSAP
gsap.registerPlugin(ScrollTrigger);

let lenis = null;

/**
 * Initialize smooth scrolling.
 * Returns the lenis instance (or null if reduced motion).
 */
export function initScroll() {
  if (prefersReducedMotion) {
    // Native scroll — ScrollTrigger works without Lenis
    ScrollTrigger.defaults({
      // Instant transitions for reduced-motion users
    });
    return null;
  }

  lenis = new Lenis({
    duration: 1.2,
    easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)), // expo.out
    orientation: 'vertical',
    smoothWheel: true,
  });

  // Connect Lenis scroll events to GSAP ScrollTrigger
  lenis.on('scroll', ScrollTrigger.update);

  // Let GSAP's ticker drive Lenis (not its own rAF)
  gsap.ticker.add((time) => {
    lenis.raf(time * 1000); // GSAP time is in seconds, Lenis expects ms
  });

  // Prevent GSAP from lagging behind
  gsap.ticker.lagSmoothing(0);

  return lenis;
}

/**
 * Tick Lenis from the main render loop.
 * Called every frame by renderer.js.
 */
export function tickScroll(time) {
  // Lenis RAF is now driven by GSAP ticker above,
  // so this is a no-op. Kept for architectural clarity.
}

export { lenis };
