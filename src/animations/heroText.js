/**
 * heroText.js — Hero Headline Character-Split Animation
 * ──────────────────────────────────────────────────────
 * Splits the hero headline into individual character <span>s
 * and staggers them in with GSAP on page load.
 *
 * No SplitText plugin dependency — manual DOM split.
 *
 * Animation: opacity 0 + translateY 20px → final state
 * Easing: expo.out
 * Stagger: 0.03s per character
 *
 * If prefers-reduced-motion: skip animation, show immediately.
 */

import gsap from 'gsap';
import { prefersReducedMotion } from '../utils/reducedMotion.js';
import { initTextParticles, initHeroNameParticles } from '../effects/textParticles.js';

/**
 * Split a text element into individual character spans.
 * Preserves spaces as separate span elements.
 * @param {HTMLElement} element - The element whose text content to split
 * @returns {HTMLElement[]} Array of character span elements
 */
function splitTextIntoChars(element) {
  const text = element.textContent;
  element.textContent = ''; // Clear original text
  element.setAttribute('aria-label', text); // Accessibility: keep full text readable

  const chars = [];

  for (let i = 0; i < text.length; i++) {
    const span = document.createElement('span');

    if (text[i] === ' ') {
      span.classList.add('char', 'char-space');
      span.innerHTML = '&nbsp;';
    } else {
      span.classList.add('char');
      span.textContent = text[i];
    }

    // Hide characters initially (GSAP will animate them in)
    span.style.opacity = '0';
    span.style.transform = 'translateY(20px)';

    element.appendChild(span);
    chars.push(span);
  }

  return chars;
}

/**
 * Initialize the hero text animation.
 * Call once after DOM is ready.
 */
export function initHeroText() {
  const heroName = document.querySelector('.hero__name');
  const heroSubhead = document.querySelector('.hero__subhead');

  if (!heroName) return;

  // ── Reduced motion: show everything immediately ──
  if (prefersReducedMotion) {
    heroName.style.opacity = '1';
    // Show the first role word statically (no particle rotation).
    if (heroSubhead) heroSubhead.style.opacity = '1';
    return;
  }

  // ── Split name into characters (static reveal, then it just stays) ──
  const chars = splitTextIntoChars(heroName);

  // ── Create the animation timeline ──
  const tl = gsap.timeline({
    delay: 0.5, // Brief pause before animation starts
    onComplete: () => {
      // Hand the subheading over to the particle system once the name has
      // settled. Small delay ensures the browser has painted the final text
      // so the sampler measures the correct glyph metrics.
      requestAnimationFrame(() => {
        initHeroNameParticles();
        initTextParticles();
      });
    },
  });

  // Stagger the name characters in — the name then remains static.
  tl.to(chars, {
    opacity: 1,
    y: 0,
    duration: 0.8,
    ease: 'expo.out',
    stagger: 0.03,
  });

  // NOTE: the subheading (Builder / Strategist / Operator) is NOT faded in via
  // GSAP — the particle system owns it and morphs between the three roles.
  // Its HTML stays visually hidden (opacity:0) as a screen-reader/SEO fallback.
  // See textParticles.js for the rotation.

  // Fade in scroll indicator
  const scrollIndicator = document.querySelector('.scroll-indicator');
  if (scrollIndicator) {
    tl.to(scrollIndicator, {
      opacity: 0.5,
      duration: 1.2,
      ease: 'power2.out',
    }, '-=0.5');
  }
}
