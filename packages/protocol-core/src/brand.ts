/**
 * Compile-time branding utility.
 *
 * Brands are type-level only (fully erasable): a `CorrelationId` is a `string`
 * at runtime, but the compiler refuses to pass an unbranded string where a
 * branded identifier is required. Runtime validation lives with each branded
 * type (see identifiers.ts).
 */

declare const brand: unique symbol;

export type Brand<T, B extends string> = T & { readonly [brand]: B };
