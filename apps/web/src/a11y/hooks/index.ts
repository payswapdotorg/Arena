/**
 * Accessibility hooks for Arena's role-aware interface
 * 
 * These hooks provide accessibility primitives that work across
 * all role-specific screens while respecting the canonical object contracts.
 */

import { useId, useRef, useEffect, useState } from 'react';

/**
 * Focus management for modal dialogs and trap
 */
export function useFocusTrap(isActive: boolean) {
  const containerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!isActive || !containerRef.current) return;

    const focusableElements = containerRef.current.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    
    const firstElement = focusableElements[0] as HTMLElement;
    const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement;

    const handleTab = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      
      if (e.shiftKey) {
        if (document.activeElement === firstElement) {
          lastElement?.focus();
          e.preventDefault();
        }
      } else {
        if (document.activeElement === lastElement) {
          firstElement?.focus();
          e.preventDefault();
        }
      }
    };

    containerRef.current.addEventListener('keydown', handleTab);
    firstElement?.focus();

    return () => {
      containerRef.current?.removeEventListener('keydown', handleTab);
    };
  }, [isActive]);

  return containerRef;
}

/**
 * Skip navigation link for keyboard users
 */
export function useSkipNavigation() {
  const skipId = useId();
  
  return {
    skipId,
    SkipLink: () => (
      <a
        href={`#${skipId}`}
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:bg-white focus:text-black focus:p-2 focus:rounded focus:z-50"
      >
        Skip to main content
      </a>
    )
  };
}

/**
 * Reduced motion preference detection
 */
export function useReducedMotion() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    setPrefersReducedMotion(mediaQuery.matches);

    const handleChange = (e: MediaQueryListEvent) => {
      setPrefersReducedMotion(e.matches);
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  return prefersReducedMotion;
}

/**
 * Keyboard navigation for complex interactive elements
 */
export function useKeyboardNavigation(
  items: Array<{ id: string; element: HTMLElement | null }>,
  options: { loop?: boolean; orientation?: 'horizontal' | 'vertical' } = {}
) {
  const { loop = true, orientation = 'vertical' } = options;
  const activeIndexRef = useRef(-1);

  const handleKeyDown = (e: KeyboardEvent) => {
    const isHorizontal = orientation === 'horizontal';
    const keys = isHorizontal 
      ? { next: 'ArrowRight', prev: 'ArrowLeft', home: 'Home', end: 'End' }
      : { next: 'ArrowDown', prev: 'ArrowUp', home: 'Home', end: 'End' };

    switch (e.key) {
      case keys.next:
        e.preventDefault();
        activeIndexRef.current = Math.min(
          activeIndexRef.current + 1,
          items.length - 1
        );
        break;
      case keys.prev:
        e.preventDefault();
        activeIndexRef.current = Math.max(
          activeIndexRef.current - 1,
          0
        );
        break;
      case keys.home:
        e.preventDefault();
        activeIndexRef.current = 0;
        break;
      case keys.end:
        e.preventDefault();
        activeIndexRef.current = items.length - 1;
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        // Trigger action on active item
        break;
    }

    // Focus the active item
    if (activeIndexRef.current >= 0 && activeIndexRef.current < items.length) {
      items[activeIndexRef.current]?.element?.focus();
    }
  };

  return { handleKeyDown, activeIndex: activeIndexRef.current };
}

/**
 * Live region for dynamic content updates
 */
export function useLiveRegion() {
  const announce = (message: string, priority: 'polite' | 'assertive' = 'polite') => {
    const liveRegion = document.getElementById('live-region');
    if (liveRegion) {
      liveRegion.setAttribute('aria-live', priority);
      liveRegion.textContent = message;
      
      // Clear after announcement
      setTimeout(() => {
        liveRegion.textContent = '';
      }, 1000);
    }
  };

  return { announce };
}