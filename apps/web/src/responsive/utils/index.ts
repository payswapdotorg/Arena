/**
 * Responsive utilities for Arena's role-aware interface
 * 
 * These utilities provide responsive helpers, breakpoint tokens,
 * and responsive validation helpers that work across all device sizes.
 */

/**
 * Breakpoint tokens for responsive design
 */
export const breakpoints = {
  mobile: 390,
  tablet: 768,
  desktop: 1280,
} as const;

export type Breakpoint = keyof typeof breakpoints;

/**
 * Spacing tokens for responsive design
 */
export const spacing = {
  xs: '0.25rem',  // 4px
  sm: '0.5rem',   // 8px
  md: '1rem',     // 16px
  lg: '1.5rem',   // 24px
  xl: '2rem',     // 32px
  '2xl': '3rem',  // 48px
} as const;

/**
 * Typography tokens for responsive design
 */
export const typography = {
  xs: '0.75rem',   // 12px
  sm: '0.875rem',  // 14px
  base: '1rem',    // 16px
  lg: '1.125rem',  // 18px
  xl: '1.25rem',   // 20px
  '2xl': '1.5rem', // 24px
  '3xl': '1.875rem', // 30px
  '4xl': '2.25rem', // 36px
} as const;

/**
 * Responsive utility functions
 */
export const ResponsiveUtils = {
  /**
   * Calculate responsive font sizes based on viewport width
   */
  getResponsiveFontSize: (baseSize: string, min: number, max: number) => {
    return `clamp(${min}px, ${baseSize}, ${max}px)`;
  },

  /**
   * Generate responsive classes for a specific property
   */
  responsiveClass: (
    property: string,
    values: Partial<Record<Breakpoint, string>>
  ): string => {
    const classes: string[] = [];
    
    Object.entries(values).forEach(([breakpoint, value]) => {
      if (breakpoint === 'mobile') {
        classes.push(`${property}-${value}`);
      } else if (breakpoint === 'tablet') {
        classes.push(`md:${property}-${value}`);
      } else if (breakpoint === 'desktop') {
        classes.push(`lg:${property}-${value}`);
      }
    });

    return classes.join(' ');
  },

  /**
   * Generate responsive grid classes
   */
  gridClass: (
    cols: Partial<Record<Breakpoint, number>>,
    gap?: Partial<Record<Breakpoint, string>>
  ): string => {
    const classes: string[] = [];
    
    Object.entries(cols).forEach(([breakpoint, colCount]) => {
      if (breakpoint === 'mobile') {
        classes.push(`grid-cols-${colCount}`);
      } else if (breakpoint === 'tablet') {
        classes.push(`md:grid-cols-${colCount}`);
      } else if (breakpoint === 'desktop') {
        classes.push(`lg:grid-cols-${colCount}`);
      }
    });

    if (gap) {
      Object.entries(gap).forEach(([breakpoint, gapValue]) => {
        if (breakpoint === 'mobile') {
          classes.push(`gap-${gapValue}`);
        } else if (breakpoint === 'tablet') {
          classes.push(`md:gap-${gapValue}`);
        } else if (breakpoint === 'desktop') {
          classes.push(`lg:gap-${gapValue}`);
        }
      });
    }

    return `grid ${classes.join(' ')}`;
  },

  /**
   * Generate responsive flex classes
   */
  flexClass: (
    direction: Partial<Record<Breakpoint, 'row' | 'col'>>,
    wrap: Partial<Record<Breakpoint, 'nowrap' | 'wrap' | 'wrap-reverse'>> = {},
    justify: Partial<Record<Breakpoint, string>> = {},
    align: Partial<Record<Breakpoint, string>> = {},
    gap: Partial<Record<Breakpoint, string>> = {}
  ): string => {
    const classes: string[] = ['flex'];
    
    Object.entries(direction).forEach(([breakpoint, dir]) => {
      if (breakpoint === 'mobile') {
        classes.push(dir === 'col' ? 'flex-col' : 'flex-row');
      } else if (breakpoint === 'tablet') {
        classes.push(`md:${dir === 'col' ? 'flex-col' : 'flex-row'}`);
      } else if (breakpoint === 'desktop') {
        classes.push(`lg:${dir === 'col' ? 'flex-col' : 'flex-row'}`);
      }
    });

    Object.entries(wrap).forEach(([breakpoint, wrapValue]) => {
      if (breakpoint === 'mobile') {
        classes.push(`flex-${wrapValue}`);
      } else if (breakpoint === 'tablet') {
        classes.push(`md:flex-${wrapValue}`);
      } else if (breakpoint === 'desktop') {
        classes.push(`lg:flex-${wrapValue}`);
      }
    });

    Object.entries(justify).forEach(([breakpoint, justifyValue]) => {
      if (breakpoint === 'mobile') {
        classes.push(`justify-${justifyValue}`);
      } else if (breakpoint === 'tablet') {
        classes.push(`md:justify-${justifyValue}`);
      } else if (breakpoint === 'desktop') {
        classes.push(`lg:justify-${justifyValue}`);
      }
    });

    Object.entries(align).forEach(([breakpoint, alignValue]) => {
      if (breakpoint === 'mobile') {
        classes.push(`items-${alignValue}`);
      } else if (breakpoint === 'tablet') {
        classes.push(`md:items-${alignValue}`);
      } else if (breakpoint === 'desktop') {
        classes.push(`lg:items-${alignValue}`);
      }
    });

    Object.entries(gap).forEach(([breakpoint, gapValue]) => {
      if (breakpoint === 'mobile') {
        classes.push(`gap-${gapValue}`);
      } else if (breakpoint === 'tablet') {
        classes.push(`md:gap-${gapValue}`);
      } else if (breakpoint === 'desktop') {
        classes.push(`lg:gap-${gapValue}`);
      }
    });

    return classes.join(' ');
  },

  /**
   * Generate responsive padding classes
   */
  paddingClass: (values: Partial<Record<Breakpoint, string>>): string => {
    const classes: string[] = [];
    
    Object.entries(values).forEach(([breakpoint, value]) => {
      if (breakpoint === 'mobile') {
        classes.push(`p-${value}`);
      } else if (breakpoint === 'tablet') {
        classes.push(`md:p-${value}`);
      } else if (breakpoint === 'desktop') {
        classes.push(`lg:p-${value}`);
      }
    });

    return classes.join(' ');
  },

  /**
   * Generate responsive margin classes
   */
  marginClass: (values: Partial<Record<Breakpoint, string>>): string => {
    const classes: string[] = [];
    
    Object.entries(values).forEach(([breakpoint, value]) => {
      if (breakpoint === 'mobile') {
        classes.push(`m-${value}`);
      } else if (breakpoint === 'tablet') {
        classes.push(`md:m-${value}`);
      } else if (breakpoint === 'desktop') {
        classes.push(`lg:m-${value}`);
      }
    });

    return classes.join(' ');
  },

  /**
   * Generate responsive width classes
   */
  widthClass: (values: Partial<Record<Breakpoint, string>>): string => {
    const classes: string[] = [];
    
    Object.entries(values).forEach(([breakpoint, value]) => {
      if (breakpoint === 'mobile') {
        classes.push(`w-${value}`);
      } else if (breakpoint === 'tablet') {
        classes.push(`md:w-${value}`);
      } else if (breakpoint === 'desktop') {
        classes.push(`lg:w-${value}`);
      }
    });

    return classes.join(' ');
  },
};

/**
 * Touch target sizing utilities for mobile accessibility
 */
export const TouchTargets = {
  /**
   * Minimum touch target size (48x48px per WCAG)
   */
  minSize: '48px',
  
  /**
   * Recommended touch target size (44x44px minimum)
   */
  recommendedSize: '44px',

  /**
   * Generate touch-friendly classes
   */
  touchTarget: (size: 'sm' | 'md' | 'lg' = 'md') => {
    const sizes = {
      sm: 'min-h-[40px] min-w-[40px]',
      md: 'min-h-[48px] min-w-[48px]',
      lg: 'min-h-[56px] min-w-[56px]',
    };

    return sizes[size];
  },

  /**
   * Generate touch-friendly spacing
   */
  touchSpacing: (size: 'sm' | 'md' | 'lg' = 'md') => {
    const spacing = {
      sm: 'space-x-2',
      md: 'space-x-4',
      lg: 'space-x-6',
    };

    return spacing[size];
  },
};

/**
 * Responsive breakpoint helpers
 */
export const BreakpointHelpers = {
  /**
   * Check if current viewport is mobile
   */
  isMobile: (): boolean => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth < breakpoints.tablet;
  },

  /**
   * Check if current viewport is tablet
   */
  isTablet: (): boolean => {
    if (typeof window === 'undefined') return false;
    const width = window.innerWidth;
    return width >= breakpoints.tablet && width < breakpoints.desktop;
  },

  /**
   * Check if current viewport is desktop
   */
  isDesktop: (): boolean => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth >= breakpoints.desktop;
  },

  /**
   * Get current breakpoint
   */
  getCurrentBreakpoint: (): Breakpoint => {
    if (typeof window === 'undefined') return 'desktop';
    
    const width = window.innerWidth;
    if (width < breakpoints.tablet) return 'mobile';
    if (width < breakpoints.desktop) return 'tablet';
    return 'desktop';
  },

  /**
   * Get breakpoint name from width
   */
  getBreakpointFromWidth: (width: number): Breakpoint => {
    if (width < breakpoints.tablet) return 'mobile';
    if (width < breakpoints.desktop) return 'tablet';
    return 'desktop';
  },
};

/**
 * Responsive validation utilities
 */
export const ResponsiveValidation = {
  /**
   * Validate responsive design implementation
   */
  validateResponsiveDesign: (element: HTMLElement): { valid: boolean; errors: string[] } => {
    const errors: string[] = [];
    
    // Check for proper viewport meta tag
    const viewportMeta = document.querySelector('meta[name="viewport"]');
    if (!viewportMeta) {
      errors.push('Missing viewport meta tag');
    } else {
      const content = viewportMeta.getAttribute('content');
      if (!content?.includes('width=device-width')) {
        errors.push('Viewport meta tag missing width=device-width');
      }
      if (!content?.includes('initial-scale=1.0')) {
        errors.push('Viewport meta tag missing initial-scale=1.0');
      }
    }

    // Check for horizontal overflow
    const hasHorizontalOverflow = element.scrollWidth > element.clientWidth;
    if (hasHorizontalOverflow) {
      errors.push('Element has horizontal overflow - consider responsive design');
    }

    // Check for responsive classes
    const responsiveClasses = ['md:', 'lg:', 'sm:', 'xl:'];
    const hasResponsiveClasses = responsiveClasses.some(cls => 
      element.className.includes(cls)
    );
    
    if (!hasResponsiveClasses && element.clientWidth < breakpoints.desktop) {
      errors.push('Element may need responsive breakpoint classes');
    }

    return { valid: errors.length === 0, errors };
  },

  /**
   * Validate touch targets
   */
  validateTouchTargets: (container: HTMLElement): { valid: boolean; errors: string[] } => {
    const errors: string[] = [];
    
    const interactiveElements = container.querySelectorAll(
      'button, a, input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );

    interactiveElements.forEach(element => {
      const rect = element.getBoundingClientRect();
      const width = rect.width;
      const height = rect.height;

      if (width < 44 || height < 44) {
        errors.push(`Touch target too small: ${element.tagName} (${width}x${height})`);
      }
    });

    return { valid: errors.length === 0, errors };
  },

  /**
   * Validate responsive images
   */
  validateResponsiveImages: (container: HTMLElement): { valid: boolean; errors: string[] } => {
    const errors: string[] = [];
    
    const images = container.querySelectorAll('img');
    
    images.forEach(img => {
      if (!img.hasAttribute('srcset') && !img.hasAttribute('sizes')) {
        errors.push(`Image missing responsive attributes: srcset/sizes`);
      }
      
      if (!img.hasAttribute('loading')) {
        errors.push(`Image missing loading attribute`);
      }
    });

    return { valid: errors.length === 0, errors };
  },
};

/**
 * Mobile navigation utilities
 */
export const MobileNavigation = {
  /**
   * Check if element is in viewport
   */
  isInViewport: (element: HTMLElement): boolean => {
    const rect = element.getBoundingClientRect();
    return (
      rect.top >= 0 &&
      rect.left >= 0 &&
      rect.bottom <= window.innerHeight &&
      rect.right <= window.innerWidth
    );
  },

  /**
   * Smooth scroll to element
   */
  scrollToElement: (element: HTMLElement, offset = 0): void => {
    const elementPosition = element.getBoundingClientRect().top;
    const offsetPosition = elementPosition + window.pageYOffset - offset;

    window.scrollTo({
      top: offsetPosition,
      behavior: 'smooth',
    });
  },

  /**
   * Check if scroll position is at bottom
   */
  isScrollAtBottom: (): boolean => {
    return window.innerHeight + window.scrollY >= document.body.offsetHeight;
  },
};
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
