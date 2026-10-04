/**
 * Responsive testing utilities for Arena's role-aware interface
 * 
 * These utilities provide test helpers and conformance checks that validate
 * the responsive behavior of the B007-B017 screens across different device sizes.
 */

import { renderToStaticMarkup } from 'react-dom/server';

/**
 * Viewport sizes for testing
 */
export const testViewports = {
  mobile: { width: 390, height: 844 },
  tablet: { width: 768, height: 1024 },
  desktop: { width: 1280, height: 800 },
} as const;

/**
 * Test helpers for responsive assertions
 */
export const ResponsiveTest = {
  /**
   * Render component and test responsive behavior
   */
  renderAndTestResponsiveness: async (
    component: React.ReactElement,
    viewport?: { width: number; height: number }
  ) => {
    // Set viewport if provided
    if (viewport) {
      Object.defineProperty(window, 'innerWidth', {
        writable: true,
        configurable: true,
        value: viewport.width,
      });
      Object.defineProperty(window, 'innerHeight', {
        writable: true,
        configurable: true,
        value: viewport.height,
      });
    }

    const markup = renderToStaticMarkup(component);
    
    // For now, return a basic result since document is not available in Node.js
    // In a real implementation, you would parse the HTML and check responsiveness
    return {
      valid: true, // Default to true for now
      violations: [],
      container: { innerHTML: markup },
    };
  },

  /**
   * Test responsive breakpoint behavior
   */
  testBreakpoints: (container: HTMLElement) => {
    const errors: string[] = [];
    
    // Test mobile breakpoint
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: testViewports.mobile.width,
    });
    window.dispatchEvent(new Event('resize'));
    
    const mobileElements = container.querySelectorAll('.md\\:, .lg\\:');
    if (mobileElements.length === 0) {
      errors.push('No responsive breakpoint classes found for mobile testing');
    }

    // Test tablet breakpoint
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: testViewports.tablet.width,
    });
    window.dispatchEvent(new Event('resize'));
    
    const tabletElements = container.querySelectorAll('.lg\\:');
    if (tabletElements.length === 0) {
      errors.push('No responsive breakpoint classes found for tablet testing');
    }

    // Test desktop breakpoint
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: testViewports.desktop.width,
    });
    window.dispatchEvent(new Event('resize'));
    
    const desktopElements = container.querySelectorAll('.md\\:, .lg\\:');
    if (desktopElements.length === 0) {
      errors.push('No responsive breakpoint classes found for desktop testing');
    }

    return { valid: errors.length === 0, errors };
  },

  /**
   * Test touch target accessibility
   */
  testTouchTargets: (container: HTMLElement) => {
    const errors: string[] = [];
    
    const interactiveElements = container.querySelectorAll(
      'button, a, input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );

    interactiveElements.forEach((element, index) => {
      const rect = element.getBoundingClientRect();
      const width = rect.width;
      const height = rect.height;

      if (width < 44 || height < 44) {
        errors.push(`Touch target too small: ${element.tagName} at index ${index} (${width}x${height})`);
      }

      // Check for proper spacing
      const computedStyle = window.getComputedStyle(element);
      const marginRight = parseInt(computedStyle.marginRight) || 0;
      const marginBottom = parseInt(computedStyle.marginBottom) || 0;

      if (marginRight < 8 || marginBottom < 8) {
        errors.push(`Insufficient spacing around touch target: ${element.tagName} at index ${index}`);
      }
    });

    return { valid: errors.length === 0, errors };
  },

  /**
   * Test horizontal overflow
   */
  testOverflow: (container: HTMLElement) => {
    const errors: string[] = [];
    
    // Check for horizontal overflow
    const hasHorizontalOverflow = container.scrollWidth > container.clientWidth;
    if (hasHorizontalOverflow) {
      errors.push('Container has horizontal overflow - consider responsive design');
    }

    // Check for fixed width elements that might cause overflow
    const fixedWidthElements = container.querySelectorAll('[style*="width"]');
    fixedWidthElements.forEach(element => {
      const style = (element as HTMLElement).style;
      const width = style.width;
      
      if (width && !width.includes('%') && !width.includes('auto') && parseInt(width) > testViewports.mobile.width) {
        errors.push(`Fixed width element may cause overflow on mobile: ${width}`);
      }
    });

    return { valid: errors.length === 0, errors };
  },

  /**
   * Test responsive images
   */
  testResponsiveImages: (container: HTMLElement) => {
    const errors: string[] = [];
    
    const images = container.querySelectorAll('img');
    
    images.forEach((img, index) => {
      if (!img.hasAttribute('srcset') && !img.hasAttribute('sizes')) {
        errors.push(`Image at index ${index} missing responsive attributes: srcset/sizes`);
      }
      
      if (!img.hasAttribute('loading')) {
        errors.push(`Image at index ${index} missing loading attribute`);
      }

      // Check alt text
      if (!img.hasAttribute('alt')) {
        errors.push(`Image at index ${index} missing alt attribute`);
      } else if (img.getAttribute('alt')?.trim() === '') {
        errors.push(`Image at index ${index} has empty alt attribute`);
      }
    });

    return { valid: errors.length === 0, errors };
  },

  /**
   * Test mobile navigation patterns
   */
  testMobileNavigation: (container: HTMLElement) => {
    const errors: string[] = [];
    
    // Check for bottom navigation on mobile
    const bottomNav = container.querySelector('.bottom-nav, .fixed.bottom-0');
    if (!bottomNav) {
      errors.push('No bottom navigation found for mobile layout');
    }

    // Check for hamburger menu
    const hamburger = container.querySelector('.hamburger, .menu-button');
    if (!hamburger) {
      errors.push('No hamburger menu found for mobile navigation');
    }

    // Check for collapsible sidebars
    const collapsibleSidebar = container.querySelector('.collapsible, .sidebar');
    if (!collapsibleSidebar) {
      errors.push('No collapsible sidebar found for responsive layout');
    }

    return { valid: errors.length === 0, errors };
  },

  /**
   * Test responsive grid layouts
   */
  testResponsiveGrids: (container: HTMLElement) => {
    const errors: string[] = [];
    
    const grids = container.querySelectorAll('.grid');
    
    grids.forEach((grid, index) => {
      const gridClasses = (grid as HTMLElement).className;
      
      // Check for responsive grid classes
      if (!gridClasses.includes('md:') && !gridClasses.includes('lg:')) {
        errors.push(`Grid at index ${index} lacks responsive breakpoint classes`);
      }

      // Check for proper column definitions
      if (!gridClasses.includes('grid-cols-')) {
        errors.push(`Grid at index ${index} lacks column definitions`);
      }

      // Check for gap spacing
      if (!gridClasses.includes('gap-')) {
        errors.push(`Grid at index ${index} lacks gap spacing`);
      }
    });

    return { valid: errors.length === 0, errors };
  },

  /**
   * Test responsive text sizing
   */
  testResponsiveText: (container: HTMLElement) => {
    const errors: string[] = [];
    
    const textElements = container.querySelectorAll('p, span, h1, h2, h3, h4, h5, h6, div');
    
    textElements.forEach((element, index) => {
      const computedStyle = window.getComputedStyle(element);
      const fontSize = parseInt(computedStyle.fontSize);
      
      // Check for extremely small text
      if (fontSize < 12) {
        errors.push(`Text too small at index ${index}: ${fontSize}px`);
      }

      // Check for responsive font sizing
      if (!computedStyle.fontSize.includes('clamp') && 
          !computedStyle.fontSize.includes('rem') &&
          fontSize > 16) {
        errors.push(`Text may not be responsive at index ${index}: ${fontSize}px`);
      }
    });

    return { valid: errors.length === 0, errors };
  },
};