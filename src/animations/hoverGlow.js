/**
 * hoverGlow.js — Interactive border glow mouse tracking
 * ────────────────────────────────────────────────────
 * Listens to mousemove events on selected elements (text inputs, textareas,
 * buttons, and cards) and sets custom properties --mouse-x and --mouse-y.
 * These are used by CSS radial-gradients to create a local illuminance effect.
 */

export function initHoverGlow() {
  const selectors = [
    '.contact__form',
    '.contact__form-input',
    '.contact__form-submit',
    '.contact__link',
    '.project-card',
    '.experience-item',
    '.education-item'
  ];

  const updateCoordinates = (e, el) => {
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    el.style.setProperty('--mouse-x', `${x}px`);
    el.style.setProperty('--mouse-y', `${y}px`);
  };

  // Find and attach listeners to existing elements
  const elements = document.querySelectorAll(selectors.join(', '));
  elements.forEach((el) => {
    el.addEventListener('mousemove', (e) => updateCoordinates(e, el));
  });

  // Handle dynamic elements if any are added in the future
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          selectors.forEach((selector) => {
            if (node.matches(selector)) {
              node.addEventListener('mousemove', (e) => updateCoordinates(e, node));
            }
            const children = node.querySelectorAll(selector);
            children.forEach((child) => {
              child.addEventListener('mousemove', (e) => updateCoordinates(e, child));
            });
          });
        }
      });
    });
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
}
