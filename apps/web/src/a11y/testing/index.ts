/**
 * Accessibility testing utilities for Arena's role-aware interface
 * 
 * These utilities provide test helpers and conformance checks that validate
 * the accessibility of the B007-B017 screens against WCAG 2.1 AA standards.
 */

import { renderToStaticMarkup } from 'react-dom/server';
import { render, screen } from '@testing-library/react';

/**
 * Test helpers for accessibility assertions
 */
export const A11yTest = {
  /**
   * Render component and check for basic accessibility violations
   */
  renderAndCheckA11y: async (component: React.ReactElement) => {
    const { container } = render(component);
    
    // Check for basic HTML structure
    const checks = [
      checkHeadings(container),
      checkLandmarks(container),
      checkFormLabels(container),
      checkAltText(container),
      checkColorContrast(container),
    ];

    const violations = checks.flatMap(result => result.errors);
    
    return {
      valid: violations.length === 0,
      violations,
      container,
    };
  },

  /**
   * Check heading structure in rendered markup
   */
  checkHeadings: (container: HTMLElement) => {
    const headings = Array.from(container.querySelectorAll('h1, h2, h3, h4, h5, h6'));
    const errors: string[] = [];
    let lastLevel = 0;

    headings.forEach((heading, index) => {
      const level = parseInt(heading.tagName.charAt(1));
      
      if (heading.id) {
        // Check if heading has proper ID for navigation
        const label = heading.textContent?.trim();
        if (label && label.length < 3) {
          errors.push(`Heading ${index + 1} text is too short: "${label}"`);
        }
      } else {
        errors.push(`Heading ${index + 1} is missing an ID attribute`);
      }

      if (level > lastLevel + 1) {
        errors.push(`Heading level ${level} skips from ${lastLevel} - headings should increment by at most 1`);
      }
      lastLevel = level;
    });

    // Check for exactly one h1
    const h1Count = headings.filter(h => h.tagName === 'H1').length;
    if (h1Count !== 1) {
      errors.push(`Expected exactly one h1, found ${h1Count}`);
    }

    return { valid: errors.length === 0, errors };
  },

  /**
   * Check landmark structure in rendered markup
   */
  checkLandmarks: (container: HTMLElement) => {
    const errors: string[] = [];
    const landmarks = container.querySelectorAll('[role]');
    
    // Check for main landmark
    const mainLandmarks = Array.from(landmarks).filter(el => el.getAttribute('role') === 'main');
    if (mainLandmarks.length === 0) {
      errors.push('No main landmark found (role="main")');
    } else if (mainLandmarks.length > 1) {
      errors.push('Multiple main landmarks found');
    }

    // Check for navigation landmarks
    const navLandmarks = Array.from(landmarks).filter(el => el.getAttribute('role') === 'navigation');
    if (navLandmarks.length === 0) {
      errors.push('No navigation landmark found (role="navigation")');
    }

    // Check for duplicate IDs
    const allIds = Array.from(container.querySelectorAll('[id]')).map(el => el.id);
    const duplicateIds = allIds.filter((id, index) => allIds.indexOf(id) !== index);
    duplicateIds.forEach(id => {
      errors.push(`Duplicate ID found: "${id}"`);
    });

    return { valid: errors.length === 0, errors };
  },

  /**
   * Check form labels in rendered markup
   */
  checkFormLabels: (container: HTMLElement) => {
    const errors: string[] = [];
    const forms = container.querySelectorAll('form');
    
    forms.forEach(form => {
      const inputs = form.querySelectorAll('input, select, textarea');
      
      inputs.forEach(input => {
        const id = input.id;
        const label = form.querySelector(`label[for="${id}"]`);
        
        if (!id) {
          errors.push('Input element missing id attribute');
        } else if (!label) {
          errors.push(`Input with id "${id}" has no associated label`);
        }
      });
    });

    return { valid: errors.length === 0, errors };
  },

  /**
   * Check alt text for images
   */
  checkAltText: (container: HTMLElement) => {
    const errors: string[] = [];
    const images = container.querySelectorAll('img');
    
    images.forEach(img => {
      if (!img.hasAttribute('alt')) {
        errors.push('Image missing alt attribute');
      } else if (img.getAttribute('alt')?.trim() === '') {
        errors.push('Image has empty alt attribute');
      }
    });

    return { valid: errors.length === 0, errors };
  },

  /**
   * Check color contrast (simplified)
   */
  checkColorContrast: (container: HTMLElement) => {
    const errors: string[] = [];
    // This is a simplified check - in production, use a proper color contrast library
    // For now, we'll just check for obvious text over white background
    const textElements = container.querySelectorAll('p, span, div, h1, h2, h3, h4, h5, h6, li, td, th');
    
    textElements.forEach(element => {
      const style = window.getComputedStyle(element);
      const color = style.color;
      const backgroundColor = style.backgroundColor;
      
      // Simple check for very light text on very light background
      if (color === 'rgb(255, 255, 255)' && backgroundColor === 'rgb(255, 255, 255)') {
        errors.push('Text color matches background color (white on white)');
      }
    });

    return { valid: errors.length === 0, errors };
  },

  /**
   * Check keyboard navigation
   */
  checkKeyboardNavigation: (container: HTMLElement) => {
    const errors: string[] = [];
    const interactiveElements = container.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    
    interactiveElements.forEach((element, index) => {
      const tabIndex = element.getAttribute('tabindex');
      if (tabIndex === '-1' && element.tagName !== 'BUTTON') {
        errors.push(`Interactive element has tabindex="-1": ${element.tagName}`);
      }
      
      // Check if element is focusable
      if (!element.isContentEditable && element.tagName !== 'BUTTON' && 
          !element.hasAttribute('href') && !['INPUT', 'SELECT', 'TEXTAREA'].includes(element.tagName)) {
        const tabIndexValue = parseInt(tabIndex || '0');
        if (tabIndexValue >= 0) {
          errors.push(`Non-standard interactive element without proper role: ${element.tagName}`);
        }
      }
    });

    return { valid: errors.length === 0, errors };
  },

  /**
   * Check ARIA attributes
   */
  checkAriaAttributes: (container: HTMLElement) => {
    const errors: string[] = [];
    const ariaElements = container.querySelectorAll('[aria-*]');
    
    ariaElements.forEach(element => {
      const ariaAttributes = Array.from(element.attributes).filter(attr => 
        attr.name.startsWith('aria-')
      );
      
      ariaAttributes.forEach(attr => {
        const value = attr.value;
        if (value === '') {
          errors.push(`Empty aria attribute: ${attr.name}`);
        }
        
        // Check for common aria attribute patterns
        if (attr.name === 'aria-required' && value !== 'true' && value !== 'false') {
          errors.push(`Invalid aria-required value: "${value}"`);
        }
        
        if (attr.name === 'aria-disabled' && value !== 'true' && value !== 'false') {
          errors.push(`Invalid aria-disabled value: "${value}"`);
        }
      });
    });

    return { valid: errors.length === 0, errors };
  },
};

/**
 * Test fixtures for common accessibility patterns
 */
export const A11yFixtures = {
  /**
   * Accessible button fixture
   */
  AccessibleButton: () => (
    <button 
      id="test-button"
      aria-label="Test button"
      onClick={() => {}}
    >
      Test Button
    </button>
  ),

  /**
   * Accessible form fixture
   */
  AccessibleForm: () => (
    <form id="test-form">
      <label htmlFor="test-input">Test Input</label>
      <input 
        id="test-input" 
        type="text" 
        aria-required="true"
      />
      <button type="submit">Submit</button>
    </form>
  ),

  /**
   * Accessible modal fixture
   */
  AccessibleModal: () => (
    <div role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <h2 id="modal-title">Test Modal</h2>
      <p>Modal content</p>
      <button>Close</button>
    </div>
  ),

  /**
   * Accessible navigation fixture
   */
  AccessibleNavigation: () => (
    <nav role="navigation" aria-label="Main navigation">
      <ul>
        <li><a href="#home">Home</a></li>
        <li><a href="#about">About</a></li>
        <li><a href="#contact">Contact</a></li>
      </ul>
    </nav>
  ),
};

/**
 * Test assertions for specific screen types
 */
export const ScreenAssertions = {
  /**
   * Assertions for cockpit/home screen
   */
  cockpit: (component: React.ReactElement) => {
    const { container } = render(component);
    
    return {
      hasRoleSwitcher: () => {
        const roleSwitcher = screen.getByRole('combobox', { name: /role/i });
        expect(roleSwitcher).toBeInTheDocument();
      },
      hasNavigation: () => {
        const navigation = screen.getByRole('navigation');
        expect(navigation).toBeInTheDocument();
      },
      hasMainContent: () => {
        const main = screen.getByRole('main');
        expect(main).toBeInTheDocument();
      },
      hasProperHeadings: () => {
        const h1 = screen.getByRole('heading', { level: 1 });
        expect(h1).toBeInTheDocument();
      },
    };
  },

  /**
   * Assertions for capability case screen
   */
  capabilityCase: (component: React.ReactElement) => {
    const { container } = render(component);
    
    return {
      hasCaseDetails: () => {
        expect(screen.getByRole('article')).toBeInTheDocument();
      },
      hasTaskList: () => {
        expect(screen.getByRole('list')).toBeInTheDocument();
      },
      hasStatusIndicators: () => {
        expect(screen.getByText(/status/i)).toBeInTheDocument();
      },
      hasActionButtons: () => {
        expect(screen.getByRole('button', { name: /create/i })).toBeInTheDocument();
      },
    };
  },

  /**
   * Assertions for expert workbench screen
   */
  expertWorkbench: (component: React.ReactElement) => {
    const { container } = render(component);
    
    return {
      hasAssignmentList: () => {
        expect(screen.getByRole('list')).toBeInTheDocument();
      },
      hasWorkbench: () => {
        expect(screen.getByRole('main')).toBeInTheDocument();
      },
      hasSubmitButton: () => {
        expect(screen.getByRole('button', { name: /submit/i })).toBeInTheDocument();
      },
      hasEvidenceSection: () => {
        expect(screen.getByText(/evidence/i)).toBeInTheDocument();
      },
    };
  },

  /**
   * Assertions for evaluation screen
   */
  evaluation: (component: React.ReactElement) => {
    const { container } = render(component);
    
    return {
      hasEvaluationResults: () => {
        expect(screen.getByText(/evaluation/i)).toBeInTheDocument();
      },
      hasVerificationSection: () => {
        expect(screen.getByText(/verification/i)).toBeInTheDocument();
      },
      hasCertificationBadge: () => {
        expect(screen.getByText(/certification/i)).toBeInTheDocument();
      },
      hasTruthLabels: () => {
        expect(screen.getByText(/verified/i)).toBeInTheDocument();
      },
    };
  },
};

/**
 * Test runner for accessibility conformance
 */
export const runA11yTests = async (component: React.ReactElement) => {
  const results = {
    passed: 0,
    failed: 0,
    errors: [] as string[],
  };

  // Run basic accessibility checks
  const a11yResult = await A11yTest.renderAndCheckA11y(component);
  if (a11yResult.valid) {
    results.passed++;
  } else {
    results.failed++;
    results.errors.push(...a11yResult.errors);
  }

  // Run specific screen tests
  const screenTests = [
    ScreenAssertions.cockpit,
    ScreenAssertions.capabilityCase,
    ScreenAssertions.expertWorkbench,
    ScreenAssertions.evaluation,
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