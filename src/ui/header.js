/**
 * header.js — Minimal Nav Header
 * ──────────────────────────────────
 * Wires up the fixed top-right header:
 *   - Hamburger toggle opens/closes the section dropdown
 *   - Smooth-scrolls to sections via Lenis (falls back to native)
 *   - Closes on outside click, Escape, or after selecting a link
 */

import { lenis } from '../core/scroll.js';

export function initHeader() {
  const toggle = document.getElementById('navToggle');
  const menu = document.getElementById('navMenu');

  if (!toggle || !menu) return;

  let isOpen = false;

  function openMenu() {
    if (isOpen) return;
    isOpen = true;
    menu.hidden = false;
    // Force a reflow so the transition runs from the hidden state
    void menu.offsetWidth;
    menu.classList.add('is-open');
    toggle.setAttribute('aria-expanded', 'true');
    toggle.setAttribute('aria-label', 'Close navigation menu');
  }

  function closeMenu() {
    if (!isOpen) return;
    isOpen = false;
    menu.classList.remove('is-open');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'Open navigation menu');

    // Hide after the close transition completes (keeps it out of tab order)
    const onEnd = (e) => {
      if (e.target === menu && e.propertyName === 'opacity' && !isOpen) {
        menu.hidden = true;
        menu.removeEventListener('transitionend', onEnd);
      }
    };
    menu.addEventListener('transitionend', onEnd);
  }

  function toggleMenu() {
    isOpen ? closeMenu() : openMenu();
  }

  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleMenu();
  });

  // Smooth scroll to the target section, then close
  menu.querySelectorAll('.nav-menu__link').forEach((link) => {
    link.addEventListener('click', (e) => {
      const targetId = link.getAttribute('href');
      const target = targetId && document.querySelector(targetId);
      if (target) {
        e.preventDefault();
        if (lenis) {
          lenis.scrollTo(target, { offset: 0 });
        } else {
          target.scrollIntoView({ behavior: 'smooth' });
        }
      }
      closeMenu();
    });
  });

  // Close on outside click
  document.addEventListener('click', (e) => {
    if (isOpen && !menu.contains(e.target) && e.target !== toggle) {
      closeMenu();
    }
  });

  // Close on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen) {
      closeMenu();
      toggle.focus();
    }
  });
}
