/**
 * Responsive hooks for Arena's role-aware interface
 * 
 * These hooks provide responsive behavior primitives that work across
 * all role-specific screens while respecting the canonical object contracts.
 */

import { useState, useEffect, useCallback } from 'react';

/**
 * Breakpoint definitions based on Arena's responsive design system
 */
export const breakpoints = {
  mobile: 390,
  tablet: 768,
  desktop: 1280,
} as const;

export type Breakpoint = keyof typeof breakpoints;

/**
 * Responsive viewport detection
 */
export function useViewport() {
  const [viewport, setViewport] = useState({
    width: typeof window !== 'undefined' ? window.innerWidth : 1280,
    height: typeof window !== 'undefined' ? window.innerHeight : 800,
    isMobile: false,
    isTablet: false,
    isDesktop: true,
  });

  const updateViewport = useCallback(() => {
    if (typeof window === 'undefined') return;

    const width = window.innerWidth;
    const height = window.innerHeight;

    setViewport({
      width,
      height,
      isMobile: width < breakpoints.tablet,
      isTablet: width >= breakpoints.tablet && width < breakpoints.desktop,
      isDesktop: width >= breakpoints.desktop,
    });
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    window.addEventListener('resize', updateViewport);
    updateViewport(); // Initial update

    return () => window.removeEventListener('resize', updateViewport);
  }, [updateViewport]);

  return viewport;
}

/**
 * Current breakpoint detection
 */
export function useBreakpoint() {
  const viewport = useViewport();

  if (viewport.width < breakpoints.tablet) return 'mobile';
  if (viewport.width < breakpoints.desktop) return 'tablet';
  return 'desktop';
}

/**
 * Media query hook for specific breakpoint checks
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const media = window.matchMedia(query);
    setMatches(media.matches);

    const listener = () => setMatches(media.matches);
    media.addEventListener('change', listener);

    return () => media.removeEventListener('change', listener);
  }, [query]);

  return matches;
}

/**
 * Touch device detection
 */
export function useTouchSupport() {
  const [isTouchDevice, setIsTouchDevice] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const checkTouchSupport = () => {
      const hasTouch = 'ontouchstart' in window || 
                     navigator.maxTouchPoints > 0 || 
                     navigator.msMaxTouchPoints > 0;
      setIsTouchDevice(hasTouch);
    };

    checkTouchSupport();
    
    // Listen for touch events to detect touch devices
    const handleTouchStart = () => {
      if (!isTouchDevice) {
        setIsTouchDevice(true);
      }
    };

    document.addEventListener('touchstart', handleTouchStart, { once: true });

    return () => {
      document.removeEventListener('touchstart', handleTouchStart);
    };
  }, []);

  return isTouchDevice;
}

/**
 * Scroll position detection
 */
export function useScrollPosition() {
  const [scrollPosition, setScrollPosition] = useState({
    x: 0,
    y: 0,
    isAtTop: true,
    isAtBottom: false,
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleScroll = () => {
      const y = window.scrollY;
      const x = window.scrollX;
      const isAtTop = y === 0;
      const isAtBottom = y + window.innerHeight >= document.documentElement.scrollHeight;

      setScrollPosition({ x, y, isAtTop, isAtBottom });
    };

    window.addEventListener('scroll', handleScroll);
    handleScroll(); // Initial check

    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return scrollPosition;
}

/**
 * Responsive layout hooks for specific components
 */
export function useResponsiveLayout() {
  const breakpoint = useBreakpoint();
  const viewport = useViewport();
  const isTouchDevice = useTouchSupport();

  return {
    breakpoint,
    viewport,
    isTouchDevice,
    isMobile: breakpoint === 'mobile',
    isTablet: breakpoint === 'tablet',
    isDesktop: breakpoint === 'desktop',
    // Layout decisions based on breakpoint
    showBottomNav: breakpoint === 'mobile',
    showSideRail: breakpoint === 'desktop',
    useBottomSheet: breakpoint === 'mobile',
    useCompactMode: breakpoint === 'mobile',
  };
}

/**
 * Touch gesture detection for mobile interactions
 */
export function useTouchGesture() {
  const [gesture, setGesture] = useState<'none' | 'swipe' | 'tap' | 'longPress'>('none');
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [startTime, setStartTime] = useState(0);

  const handleTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    setPosition({ x: touch.clientX, y: touch.clientY });
    setStartTime(Date.now());
    setGesture('tap');
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (gesture === 'none') return;

    const touch = e.touches[0];
    const deltaX = touch.clientX - position.x;
    const deltaY = touch.clientY - position.y;
    const deltaTime = Date.now() - startTime;

    // Check for swipe gesture
    if (Math.abs(deltaX) > 50 || Math.abs(deltaY) > 50) {
      setGesture('swipe');
    }
  };

  const handleTouchEnd = () => {
    const deltaTime = Date.now() - startTime;
    
    // Check for long press
    if (deltaTime > 500) {
      setGesture('longPress');
    } else {
      setGesture('tap');
    }
  };

  return {
    gesture,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
  };
}

/**
 * Responsive container sizing
 */
export function useResponsiveContainer() {
  const breakpoint = useBreakpoint();
  const viewport = useViewport();

  const containerWidth = {
    mobile: '100%',
    tablet: '90%',
    desktop: '1280px',
  }[breakpoint];

  const maxWidth = {
    mobile: viewport.width,
    tablet: breakpoints.desktop,
    desktop: breakpoints.desktop,
  }[breakpoint];

  return {
    containerWidth,
    maxWidth,
    breakpoint,
  };
}

/**
 * Orientation detection for mobile devices
 */
export function useOrientation() {
  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>('portrait');

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleOrientation = () => {
      const isPortrait = window.innerHeight > window.innerWidth;
      setOrientation(isPortrait ? 'portrait' : 'landscape');
    };

    handleOrientation(); // Initial check
    window.addEventListener('resize', handleOrientation);

    return () => window.removeEventListener('resize', handleOrientation);
  }, []);

  return orientation;
}