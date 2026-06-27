/**
 * scrollCamera.js — Scroll-Driven Camera Animation
 * ──────────────────────────────────────────────────
 * GSAP ScrollTrigger drives camera position and rotation
 * between section landmarks as the user scrolls.
 *
 * Keyframes:
 *   Hero (0%)      → Camera close to icosahedron
 *   Projects (25%) → Camera pulls back, slight shift
 *   Experience     → Camera continues back
 *   Contact        → Final position
 *
 * All driven by Lenis scroll progress fed into ScrollTrigger.
 */

import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { camera } from '../core/camera.js';
import { heroGroup } from '../scenes/hero.js';
import { prefersReducedMotion } from '../utils/reducedMotion.js';

gsap.registerPlugin(ScrollTrigger);

/**
 * Initialize scroll-driven camera movement.
 * Must be called after scroll.js has initialized Lenis + ScrollTrigger.
 */
export function initScrollCamera() {
  if (prefersReducedMotion) {
    // For reduced motion, camera stays in a single position
    // that works for all sections — shifted slightly right to frame offset icosahedron
    camera.position.set(0.8, 0, 5);
    return;
  }

  // ── Master timeline tied to overall scroll progress ──
  const tl = gsap.timeline({
    scrollTrigger: {
      trigger: '.content',
      start: 'top top',
      end: 'bottom bottom',
      scrub: 1.5, // Smooth interpolation with slight delay
    },
  });

  // Hero → Projects: camera pulls back and shifts slightly right
  tl.to(camera.position, {
    x: 2.0,
    y: 0.5,
    z: 7,
    duration: 1,
    ease: 'none',
  }, 0);

  // Projects → Experience: camera continues drifting
  tl.to(camera.position, {
    x: 0.5,
    y: 1.0,
    z: 9,
    duration: 1,
    ease: 'none',
  }, 1);

  // Experience → Contact: camera pulls way back
  tl.to(camera.position, {
    x: 0.8,
    y: 0.5,
    z: 12,
    duration: 1,
    ease: 'none',
  }, 2);

  // Rotate the hero object subtly as user scrolls past
  gsap.to(heroGroup.rotation, {
    y: Math.PI * 2,  // Full rotation over entire scroll
    scrollTrigger: {
      trigger: '.content',
      start: 'top top',
      end: 'bottom bottom',
      scrub: 3,
    },
  });

  // Scale down the hero object as user scrolls away from hero section
  gsap.to(heroGroup.scale, {
    x: 0.6,
    y: 0.6,
    z: 0.6,
    scrollTrigger: {
      trigger: '#projects',
      start: 'top bottom',
      end: 'top center',
      scrub: 1,
    },
  });

  // ── Section Reveal Animations ──
  // Each section's content fades/slides in as it enters the viewport

  // Projects cards
  gsap.utils.toArray('.project-card').forEach((card, i) => {
    gsap.from(card, {
      opacity: 0,
      y: 40,
      duration: 0.8,
      ease: 'power2.out',
      scrollTrigger: {
        trigger: card,
        start: 'top 85%',
        toggleActions: 'play none none reverse',
      },
      delay: i * 0.1,
    });
  });

  // Experience items
  gsap.utils.toArray('.experience-item').forEach((item, i) => {
    gsap.from(item, {
      opacity: 0,
      x: -30,
      duration: 0.6,
      ease: 'power2.out',
      scrollTrigger: {
        trigger: item,
        start: 'top 85%',
        toggleActions: 'play none none reverse',
      },
      delay: i * 0.08,
    });
  });

  // Section titles
  gsap.utils.toArray('.section__title').forEach((title) => {
    gsap.from(title, {
      opacity: 0,
      y: 20,
      duration: 0.8,
      ease: 'expo.out',
      scrollTrigger: {
        trigger: title,
        start: 'top 85%',
        toggleActions: 'play none none reverse',
      },
    });
  });

  // Section labels
  gsap.utils.toArray('.section__label').forEach((label) => {
    gsap.from(label, {
      opacity: 0,
      y: 10,
      duration: 0.6,
      ease: 'power2.out',
      scrollTrigger: {
        trigger: label,
        start: 'top 85%',
        toggleActions: 'play none none reverse',
      },
    });
  });

  // Contact section
  const contactHeading = document.querySelector('.contact__heading');
  if (contactHeading) {
    gsap.from(contactHeading, {
      opacity: 0,
      y: 30,
      duration: 1,
      ease: 'expo.out',
      scrollTrigger: {
        trigger: contactHeading,
        start: 'top 80%',
        toggleActions: 'play none none reverse',
      },
    });
  }
}
