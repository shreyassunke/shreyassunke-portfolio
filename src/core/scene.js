/**
 * scene.js — Three.js Scene Setup
 * ─────────────────────────────────
 * No background color — the NASA starfield skybox sphere
 * renders behind all scene objects.
 * The only light comes from scene objects themselves.
 */

import * as THREE from 'three';

const scene = new THREE.Scene();
scene.background = null;

export { scene };
