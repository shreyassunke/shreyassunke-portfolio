/**
 * reducedMotion.js
 * ────────────────
 * Detects OS-level prefers-reduced-motion setting.
 * All animation modules check this before running.
 */

const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

export let prefersReducedMotion = motionQuery.matches;

// Listen for changes (user can toggle in OS settings)
motionQuery.addEventListener('change', (e) => {
  prefersReducedMotion = e.matches;
});
