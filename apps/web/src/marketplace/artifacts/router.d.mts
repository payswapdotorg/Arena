/**
 * Type surface for router.mjs (the pure marketplace router/renderer).
 * Self-contained for the same reason as corpus.d.mts.
 */

/** A marketplace request (method + normalized path). */
export interface MarketplaceRequestShape {
  readonly method: string;
  readonly path: string;
}

/** A rendered marketplace response (the transport contract). */
export interface MarketplaceResponseShape {
  readonly status: number;
  readonly contentType: string;
  readonly html: string;
  readonly allow?: string;
}

/** The read-only routes the pure router serves. */
export const MARKETPLACE_ROUTES: readonly string[];

/** The only allowed methods (read-only surface). */
export const MARKETPLACE_ALLOWED_METHODS: readonly string[];

/** Pure request handler: normalized request + frozen corpus → response. */
export function handleMarketplaceRequest(
  request: MarketplaceRequestShape,
  corpus: unknown,
): MarketplaceResponseShape;

/** Deep-freeze helper (house discipline, shared with the corpus). */
export function deepFreeze<T>(value: T): T;

/** Structural deep-frozen check. */
export function isDeepFrozen(value: unknown): boolean;

/** HTML escaping used by every renderer interpolation. */
export function escapeHtml(value: unknown): string;
