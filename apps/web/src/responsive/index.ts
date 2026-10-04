/**
 * Arena Responsive Layer RESP1.0
 * 
 * Responsive and mobile primitives for Arena's role-aware product interface.
 * These components and utilities ensure the product works across all device sizes
 * while supporting the complex workflows of AI capability development.
 * 
 * Ownership: B018 - Accessibility, Mobile, Performance, Resilience and Launch Polish
 */

export {
  useViewport,
  useBreakpoint,
  useMediaQuery,
  useTouchSupport,
  useScrollPosition,
  useResponsiveLayout,
  useTouchGesture,
  useResponsiveContainer,
  useOrientation,
} from './hooks';
export * from './components';
export * from './utils';
export * from './testing';