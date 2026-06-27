/**
 * camera.js — PerspectiveCamera Setup
 * ─────────────────────────────────────
 * Single camera instance used across the entire site.
 * Scroll-driven position/rotation is handled by scrollCamera.js.
 */

import * as THREE from 'three';

const camera = new THREE.PerspectiveCamera(
  45,                                         // FOV
  window.innerWidth / window.innerHeight,     // Aspect ratio
  0.1,                                        // Near plane
  1000                                        // Far plane (extended for starfield skybox)
);

// Default hero position — shifted right to frame the offset icosahedron
camera.position.set(0.8, 0, 5);
camera.lookAt(0.8, 0, 0);

/**
 * Update camera aspect ratio on resize.
 * Called by the renderer's resize handler.
 */
export function updateCameraAspect() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}

export { camera };
