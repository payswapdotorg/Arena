/**
 * Responsive testing utilities for Arena's role-aware interface
 * 
 * These utilities provide test helpers and conformance checks that validate
 * the responsive behavior of the B007-B017 screens across different device sizes.
 */

import { renderToStaticMarkup } from 'react-dom/server';
import { render, screen } from '@testing-library/react';

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

    const { container } = render(component);
    
    // Trigger resize event to update responsive hooks
    window.dispatchEvent(new Event('resize'));
    
    const checks = [
      testBreakpoints(container),
      testTouchTargets(container),
      testOverflow(container),
      testResponsiveImages(container),
    ];

    const violations = checks.flatMap(result => result.errors);
    
    return {
      valid: violations.length === 0,
      violations,
      container,
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

/**
 * Test fixtures for responsive patterns
 */
export const ResponsiveFixtures = {
  /**
   * Responsive navigation fixture
   */
  ResponsiveNavigation: () => (
    <nav className="flex">
      <div className="hidden lg:block w-64">Desktop Navigation</div>
      <div className="flex-1">Main Content</div>
      <div className="lg:hidden fixed bottom-0">Mobile Navigation</div>
    </nav>
  ),

  /**
   * Responsive grid fixture
   */
  ResponsiveGrid: () => (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      <div>Item 1</div>
      <div>Item 2</div>
      <div>Item 3</div>
    </div>
  ),

  /**
   * Responsive table fixture
   */
  ResponsiveTable: () => (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr>
            <th>Header 1</th>
            <th>Header 2</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Data 1</td>
            <td>Data 2</td>
          </tr>
        </tbody>
      </table>
    </div>
  ),

  /**
   * Responsive modal fixture
   */
  ResponsiveModal: () => (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="p-6">Modal Content</div>
      </div>
    </div>
  ),
};

/**
 * Test assertions for specific screen types
 */
export const ResponsiveAssertions = {
  /**
   * Assertions for cockpit/home screen
   */
  cockpit: (component: React.ReactElement) => {
    const { container } = render(component);
    
    return {
      hasMobileLayout: () => {
        const viewport = { width: 390, height: 844 };
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
        window.dispatchEvent(new Event('resize'));
        
        expect(screen.getByRole('navigation')).toBeInTheDocument();
        expect(screen.getByRole('main')).toBeInTheDocument();
      },
      hasDesktopLayout: () => {
        const viewport = { width: 1280, height: 800 };
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
        window.dispatchEvent(new Event('resize'));
        
        expect(screen.getByRole('navigation')).toBeInTheDocument();
        expect(screen.getByRole('main')).toBeInTheDocument();
      },
      hasBottomNav: () => {
        const bottomNav = container.querySelector('.fixed.bottom-0');
        expect(bottomNav).toBeInTheDocument();
      },
      hasSideRail: () => {
        const sideRail = container.querySelector('.hidden.lg\\:block');
        expect(sideRail).toBeInTheDocument();
      },
    };
  },

  /**
   * Assertions for capability case screen
   */
  capabilityCase: (component: React.ReactElement) => {
    const { container } = render(component);
    
    return {
      hasResponsiveGrid: () => {
        const grid = container.querySelector('.grid');
        expect(grid).toBeInTheDocument();
      },
      hasMobileOptimizedTable: () => {
        const tableContainer = container.querySelector('.overflow-x-auto');
        expect(tableContainer).toBeInTheDocument();
      },
      hasTouchFriendlyButtons: () => {
        const buttons = container.querySelectorAll('button');
        buttons.forEach(button => {
          const rect = button.getBoundingClientRect();
          expect(rect.width).toBeGreaterThanOrEqual(44);
          expect(rect.height).toBeGreaterThanOrEqual(44);
        });
      },
      hasResponsiveImages: () => {
        const images = container.querySelectorAll('img');
        images.forEach(img => {
          expect(img).toHaveAttribute('loading');
          expect(img).toHaveAttribute('alt');
        });
      },
    };
  },

  /**
   * Assertions for expert workbench screen
   */
  expertWorkbench: (component: React.ReactElement) => {
    const { container } = render(component);
    
    return {
      hasMobileBottomSheet: () => {
        const bottomSheet = container.querySelector('.fixed.bottom-0');
        expect(bottomSheet).toBeInTheDocument();
      },
      hasResponsiveLayout: () => {
        const layout = container.querySelector('.flex');
        expect(layout).toBeInTheDocument();
      },
      hasTouchTargets: () => {
        const interactiveElements = container.querySelectorAll(
          'button, a, input, select, textarea'
        );
        interactiveElements.forEach(element => {
          const rect = element.getBoundingClientRect();
          expect(rect.width).toBeGreaterThanOrEqual(44);
          expect(rect.height).toBeGreaterThanOrEqual(44);
        });
      },
      hasNoHorizontalOverflow: () => {
        expect(container.scrollWidth).toBeLessThanOrEqual(container.clientWidth);
      },
    };
  },

  /**
   * Assertions for evaluation screen
   */
  evaluation: (component: React.ReactElement) => {
    const { container } = render(component);
    
    return {
      hasResponsiveCharts: () => {
        const chartContainer = container.querySelector('.chart-container');
        expect(chartContainer).toBeInTheDocument();
      },
      hasMobileOptimizedText: () => {
        const textElements = container.querySelectorAll('p, span, h1, h2, h3');
        textElements.forEach(element => {
          const computedStyle = window.getComputedStyle(element);
          expect(parseInt(computedStyle.fontSize)).toBeGreaterThanOrEqual(12);
        });
      },
      hasResponsiveModal: () => {
        const modal = container.querySelector('.fixed.inset-0');
        expect(modal).toBeInTheDocument();
      },
      hasBreakpointClasses: () => {
        const elements = container.querySelectorAll('.md\\:, .lg\\:');
        expect(elements.length).toBeGreaterThan(0);
      },
    };
  },
};

/**
 * Test runner for responsive conformance
 */
export const runResponsiveTests = async (component: React.ReactElement) => {
  const results = {
    passed: 0,
    failed: 0,
    errors: [] as string[],
  };

  // Test mobile viewport
  const mobileResult = await ResponsiveTest.renderAndTestResponsiveness(
    component,
    testViewports.mobile
  );
  if (mobileResult.valid) {
    results.passed++;
  } else {
    results.failed++;
    results.errors.push(...mobileResult.errors);
  }

  // Test tablet viewport
  const tabletResult = await ResponsiveTest.renderAndTestResponsiveness(
    component,
    testViewports.tablet
  );
  if (tabletResult.valid) {
    results.passed++;
  } else {
    results.failed++;
    results.errors.push(...tabletResult.errors);
  }

  // Test desktop viewport
  const desktopResult = await ResponsiveTest.renderAndTestResponsiveness(
    component,
    testViewports.desktop
  );
  if (desktopResult.valid) {
    results.passed++;
  } else {
    results.failed++;
    results.errors.push(...desktopResult.errors);
  }

  // Run specific screen tests
  const screenTests = [
    ResponsiveAssertions.cockpit,
    ResponsiveAssertions.capabilityCase,
    ResponsiveAssertions.expertWorkbench,
    ResponsiveAssertions.evaluation,
  ];

  for (const test of screenTests) {
    try {
      const testResult = test(component);
      // Run the assertions
      Object.values(testResult).forEach(assertion => {
        if (typeof assertion === 'function') {
          try {
            assertion();
            results.passed++;
          } catch (error) {
            results.failed++;
            results.errors.push(error instanceof Error ? error.message : String(error));
          }
        }
      });
    } catch (error) {
      results.failed++;
      results.errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  return results;
};