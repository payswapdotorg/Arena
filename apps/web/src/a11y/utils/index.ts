/**
 * Accessibility utilities for Arena's role-aware interface
 * 
 * These utilities provide ARIA helpers, semantic markup functions,
 * and accessibility validation helpers that work across all role-specific screens.
 */

/**
 * ARIA role helpers for semantic HTML elements
 */
export const Aria = {
  /**
   * Create ARIA button attributes for clickable elements that aren't buttons
   */
  button: (onClick: () => void, disabled = false) => ({
    role: 'button',
    tabIndex: disabled ? -1 : 0,
    onClick,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onClick();
      }
    },
    'aria-disabled': disabled,
  }),

  /**
   * Create ARIA tree item attributes for hierarchical content
   */
  treeItem: (expanded: boolean, onToggle: () => void) => ({
    role: 'treeitem',
    'aria-expanded': expanded,
    'aria-selected': false,
    onClick: onToggle,
  }),

  /**
   * Create ARIA tab attributes for tabbed interfaces
   */
  tab: (selected: boolean, panelId: string) => ({
    role: 'tab',
    'aria-selected': selected,
    'aria-controls': panelId,
    tabIndex: selected ? 0 : -1,
  }),

  /**
   * Create ARIA tab panel attributes
   */
  tabPanel: (panelId: string, tabId: string) => ({
    role: 'tabpanel',
    'aria-labelledby': tabId,
    id: panelId,
    hidden: false,
  }),

  /**
   * Create ARIA listbox attributes for selection controls
   */
  listbox: (multiple = false) => ({
    role: 'listbox',
    'aria-multiselectable': multiple,
  }),

  /**
   * Create ARIA list item attributes
   */
  listItem: (selected: boolean) => ({
    role: 'option',
    'aria-selected': selected,
  }),
};

/**
 * Semantic HTML helpers for proper landmark structure
 */
export const Landmarks = {
  /**
   * Main content landmark
   */
  main: (id?: string) => ({
    role: 'main',
    id,
  }),

  /**
   * Navigation landmark
   */
  navigation: (id?: string) => ({
    role: 'navigation',
    'aria-label': id ? `Navigation: ${id}` : 'Main navigation',
    id,
  }),

  /**
   * Complementary landmark (sidebar, related content)
   */
  complementary: (id?: string) => ({
    role: 'complementary',
    'aria-label': id ? `Related: ${id}` : 'Related content',
    id,
  }),

  /**
   * Contentinfo landmark (footer information)
   */
  contentInfo: (id?: string) => ({
    role: 'contentinfo',
    'aria-label': id ? `Information: ${id}` : 'Page information',
    id,
  }),

  /**
   * Form landmark
   */
  form: (id?: string) => ({
    role: 'form',
    'aria-label': id ? `Form: ${id}` : 'Form',
    id,
  }),
};

/**
 * Heading structure helpers for proper document outline
 */
export const Headings = {
  /**
   * Create heading props with proper nesting
   */
  heading: (level: 1 | 2 | 3 | 4 | 5 | 6, id?: string) => ({
    id,
    role: 'heading',
    'aria-level': level,
  }),

  /**
   * Generate heading IDs for navigation
   */
  generateId: (text: string) => {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
  },
};

/**
 * Focus management utilities
 */
export const Focus = {
  /**
   * Focus the first focusable element in a container
   */
  first: (container: HTMLElement) => {
    const focusable = container.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length > 0) {
      (focusable[0] as HTMLElement).focus();
    }
  },

  /**
   * Focus the last focusable element in a container
   */
  last: (container: HTMLElement) => {
    const focusable = container.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length > 0) {
      (focusable[focusable.length - 1] as HTMLElement).focus();
    }
  },

  /**
   * Trap focus within a container
   */
  trap: (container: HTMLElement, event: KeyboardEvent) => {
    if (event.key !== 'Tab') return;

    const focusable = container.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    ) as NodeListOf<HTMLElement>;

    const firstElement = focusable[0];
    const lastElement = focusable[focusable.length - 1];

    if (event.shiftKey) {
      if (document.activeElement === firstElement) {
        lastElement?.focus();
        event.preventDefault();
      }
    } else {
      if (document.activeElement === lastElement) {
        firstElement?.focus();
        event.preventDefault();
      }
    }
  },
};

/**
 * Keyboard navigation helpers
 */
export const Keyboard = {
  /**
   * Handle arrow key navigation in grids
   */
  gridNavigation: (
    event: KeyboardEvent,
    rows: number,
    cols: number,
    currentPos: { row: number; col: number }
  ) => {
    const { row, col } = currentPos;
    let newRow = row;
    let newCol = col;

    switch (event.key) {
      case 'ArrowUp':
        newRow = Math.max(0, row - 1);
        event.preventDefault();
        break;
      case 'ArrowDown':
        newRow = Math.min(rows - 1, row + 1);
        event.preventDefault();
        break;
      case 'ArrowLeft':
        newCol = Math.max(0, col - 1);
        event.preventDefault();
        break;
      case 'ArrowRight':
        newCol = Math.min(cols - 1, col + 1);
        event.preventDefault();
        break;
      case 'Home':
        newRow = 0;
        newCol = 0;
        event.preventDefault();
        break;
      case 'End':
        newRow = rows - 1;
        newCol = cols - 1;
        event.preventDefault();
        break;
    }

    return { row: newRow, col: newCol };
  },

  /**
   * Handle escape key actions
   */
  escape: (event: KeyboardEvent, action: () => void) => {
    if (event.key === 'Escape') {
      action();
      event.preventDefault();
    }
  },
};

/**
 * Color contrast utilities
 */
export const Contrast = {
  /**
   * Check if text color has sufficient contrast against background
   */
  hasSufficientContrast: (textColor: string, backgroundColor: string): boolean => {
    // This is a simplified contrast checker
    // In production, use a proper color contrast library
    const textLuminance = getLuminance(textColor);
    const bgLuminance = getLuminance(backgroundColor);
    const contrast = (textLuminance + 0.05) / (bgLuminance + 0.05);
    return contrast >= 4.5; // WCAG AA standard
  },

  /**
   * Get relative luminance of a color (simplified)
   */
  getLuminance: (color: string): number => {
    // Simplified luminance calculation
    // In production, use a proper color library
    if (color.startsWith('#')) {
      const r = parseInt(color.slice(1, 3), 16) / 255;
      const g = parseInt(color.slice(3, 5), 16) / 255;
      const b = parseInt(color.slice(5, 7), 16) / 255;
      
      const [rs = 0, gs = 0, bs = 0] = [r, g, b].map(c => {
        c = c / 12.92;
        if (c <= 0.03928) return c;
        return Math.pow((c + 0.055) / 1.055, 2.4);
      });
      
      return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
    }
    return 0.5; // Default fallback
  },
};

/**
 * Accessibility validation helpers
 */
export const Validation = {
  /**
   * Validate proper heading structure
   */
  validateHeadings: (headings: Array<{ level: number; id: string }>): { valid: boolean; errors: string[] } => {
    const errors: string[] = [];
    let lastLevel = 0;

    for (const heading of headings) {
      if (heading.level > lastLevel + 1) {
        errors.push(`Heading level ${heading.level} skips from ${lastLevel} - headings should increment by at most 1`);
      }
      lastLevel = heading.level;
    }

    return { valid: errors.length === 0, errors };
  },

  /**
   * Validate form labels
   */
  validateFormLabels: (form: HTMLFormElement): { valid: boolean; errors: string[] } => {
    const errors: string[] = [];
    const inputs = form.querySelectorAll('input, select, textarea');

    inputs.forEach(input => {
      const id = input.id;
      const label = form.querySelector(`label[for="${id}"]`);
      
      if (!id) {
        errors.push(`Input element missing id attribute`);
      } else if (!label) {
        errors.push(`Input with id "${id}" has no associated label`);
      }
    });

    return { valid: errors.length === 0, errors };
  },

  /**
   * Validate landmark structure
   */
  validateLandmarks: (): { valid: boolean; errors: string[] } => {
    const errors: string[] = [];
    const landmarks = document.querySelectorAll('[role]');
    
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

    return { valid: errors.length === 0, errors };
  },
};

/**
 * Simplified luminance function for Contrast
 */
function getLuminance(color: string): number {
  if (color.startsWith('#')) {
    const r = parseInt(color.slice(1, 3), 16) / 255;
    const g = parseInt(color.slice(3, 5), 16) / 255;
    const b = parseInt(color.slice(5, 7), 16) / 255;
    
    const [rs = 0, gs = 0, bs = 0] = [r, g, b].map(c => {
      c = c / 12.92;
      if (c <= 0.03928) return c;
      return Math.pow((c + 0.055) / 1.055, 2.4);
    });
    
    return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
  }
  return 0.5; // Default fallback
}
/**
 * Class name utility for combining CSS classes conditionally (B018).
 * Local replacement for the nonexistent shadcn-style '@/lib/utils' module.
 */
export function cn(
  ...classes: Array<string | undefined | null | false | Record<string, boolean>>
): string {
  return classes
    .flat()
    .filter((cls): cls is string | Record<string, boolean> => Boolean(cls))
    .map((cls) => {
      if (typeof cls === 'string') {
        return cls.trim();
      }
      return Object.entries(cls)
        .filter(([, condition]) => Boolean(condition))
        .map(([className]) => className.trim())
        .join(' ');
    })
    .filter(Boolean)
    .join(' ');
}
