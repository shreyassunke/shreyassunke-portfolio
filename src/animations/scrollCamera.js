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
    // that works for all sections
    camera.position.set(window.innerWidth < 768 ? 0 : 0.8, 0, 5);
    camera.lookAt(window.innerWidth < 768 ? 0 : 0.8, 0, 0);
    return;
  }

  const mm = gsap.matchMedia();

  // ── Desktop Setup (>= 768px) ──
  mm.add("(min-width: 768px)", () => {
    // Position icosahedron on the right side of the viewport
    heroGroup.position.set(2.5, 0.3, 0);
    heroGroup.scale.set(1.0, 1.0, 1.0);
    camera.position.set(0.8, 0, 5);
    camera.lookAt(0.8, 0, 0);

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
  });

  // ── Mobile Setup (< 768px) ──
  mm.add("(max-width: 767px)", () => {
    // Centered and higher up to complement mobile stacked layout
    heroGroup.position.set(0, 1.2, 0);
    heroGroup.scale.set(0.7, 0.7, 0.7);
    camera.position.set(0, 0.5, 5.5);
    camera.lookAt(0, 0.5, 0);

    const tl = gsap.timeline({
      scrollTrigger: {
        trigger: '.content',
        start: 'top top',
        end: 'bottom bottom',
        scrub: 1.5,
      },
    });

    // Hero → Projects: camera pulls back slightly
    tl.to(camera.position, {
      x: 0,
      y: 0.2,
      z: 7.5,
      duration: 1,
      ease: 'none',
    }, 0);

    // Projects → Experience: camera continues pulling back, lowers slightly
    tl.to(camera.position, {
      x: 0,
      y: -0.4,
      z: 9.5,
      duration: 1,
      ease: 'none',
    }, 1);

    // Experience → Contact: camera pulls way back
    tl.to(camera.position, {
      x: 0,
      y: 0.1,
      z: 11.5,
      duration: 1,
      ease: 'none',
    }, 2);

    // Scale down the hero object as user scrolls away from hero section on mobile
    gsap.to(heroGroup.scale, {
      x: 0.35,
      y: 0.35,
      z: 0.35,
      scrollTrigger: {
        trigger: '#projects',
        start: 'top bottom',
        end: 'top center',
        scrub: 1,
      },
    });
  });

  // Rotate the hero object subtly as user scrolls past (common to both)
  gsap.to(heroGroup.rotation, {
    y: Math.PI * 2,  // Full rotation over entire scroll
    scrollTrigger: {
      trigger: '.content',
      start: 'top top',
      end: 'bottom bottom',
      scrub: 3,
    },
  });

  // ── Section Reveal Animations ──

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

  // Experience & education items
  gsap.utils.toArray('.experience-item, .education-item, .honors-item').forEach((item, i) => {
    gsap.from(item, {
      opacity: 0,
      x: window.innerWidth < 768 ? -10 : -30,
      duration: 0.6,
      ease: 'power2.out',
      scrollTrigger: {
        trigger: item,
        start: 'top 85%',
        toggleActions: 'play none none reverse',
      },
      delay: i * 0.06,
    });
  });

  // Skills groups
  gsap.utils.toArray('.skills-group').forEach((group, i) => {
    gsap.from(group, {
      opacity: 0,
      y: 24,
      duration: 0.6,
      ease: 'power2.out',
      scrollTrigger: {
        trigger: group,
        start: 'top 88%',
        toggleActions: 'play none none reverse',
      },
      delay: i * 0.05,
    });
  });

  // Subsection titles
  gsap.utils.toArray('.subsection__title').forEach((title) => {
    gsap.from(title, {
      opacity: 0,
      y: 12,
      duration: 0.5,
      ease: 'power2.out',
      scrollTrigger: {
        trigger: title,
        start: 'top 88%',
        toggleActions: 'play none none reverse',
      },
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
