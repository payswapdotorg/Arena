/**
 * Barrel for the Next.js session boundary (Work Order B004; BRIEF.md
 * §4.3). SERVER-ONLY: importing this module (or any of its members) from
 * a Client Component is a build-time contract violation — next/headers
 * and the route-handler factories exist only in server contexts.
 */

export * from './session.js';
export * from './csrf.js';
export * from './handlers.js';
export * from './middleware.js';
