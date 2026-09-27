/**
 * EnvironmentImage — the image/build digest declaration (spec ENV1.0
 * "image/build digest"; Work Order A009 gate 2, field group 2).
 *
 * The executable substrate of an environment is addressed EXCLUSIVELY
 * through content digests — never through a runner name, registry brand or
 * transport. The declaration carries:
 *   - `digest`: the sha256 content digest of the executable image (what the
 *     runner must materialize before start);
 *   - `buildDigest`: the digest of the build inputs/recipe that produced
 *     the image, when the image was built through a content-addressed
 *     build (null when the image is only known by its content digest);
 *   - `imageKind`: a closed, runtime-neutral classification of the
 *     executable substrate ('content-addressed-image' | 'derived-image').
 *
 * There is deliberately NO field for a registry, transport or runner: the
 * environment protocol stays runtime-neutral (Work Order A009 gate 10) and
 * the runner (Work Order A010) resolves how to materialize a digest.
 */

import { ENVIRONMENT_ERROR_CODES, EnvironmentError } from './errors.js';
import type { ContentDigest } from './shared.js';
import { expectEnumMember, expectFields, isContentDigest, toContentDigest } from './shared.js';

/** Closed classification of the executable substrate. */
export const IMAGE_KINDS = Object.freeze(['content-addressed-image', 'derived-image'] as const);
export type ImageKind = (typeof IMAGE_KINDS)[number];

/** The image/build digest declaration (all 15-field-group members are required). */
export interface EnvironmentImage {
  readonly imageKind: ImageKind;
  readonly digest: ContentDigest;
  readonly buildDigest: ContentDigest | null;
}

export function isEnvironmentImage(value: unknown): value is EnvironmentImage {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['imageKind'] === 'string' &&
    (IMAGE_KINDS as readonly string[]).includes(candidate['imageKind']) &&
    isContentDigest(candidate['digest']) &&
    (candidate['buildDigest'] === null || isContentDigest(candidate['buildDigest']))
  );
}

/** Validate (all parts) and freeze an image declaration. */
export function toEnvironmentImage(value: {
  imageKind: string;
  digest: string;
  buildDigest: string | null;
}): EnvironmentImage {
  const record = expectFields(
    value,
    ['imageKind', 'digest', 'buildDigest'],
    [],
    ENVIRONMENT_ERROR_CODES.INVALID_IMAGE,
    'environment image',
  );
  const imageKind = expectEnumMember(
    record['imageKind'],
    IMAGE_KINDS,
    'imageKind',
    ENVIRONMENT_ERROR_CODES.INVALID_IMAGE,
    'environment image',
  );
  const digest = toContentDigest(
    typeof record['digest'] === 'string' ? record['digest'] : '',
  );
  const rawBuild = record['buildDigest'];
  if (rawBuild !== null && typeof rawBuild !== 'string') {
    throw new EnvironmentError(ENVIRONMENT_ERROR_CODES.INVALID_IMAGE, {
      message: `environment image: buildDigest must be a content digest or null, got: ${String(rawBuild)}`,
    });
  }
  const buildDigest = rawBuild === null ? null : toContentDigest(rawBuild);
  return Object.freeze({ imageKind, digest, buildDigest });
}

/**
 * A derived image commits to BOTH its own content digest and the digest of
 * the build that derived it; a missing buildDigest is therefore rejected
 * for derived images.
 */
export function assertImageConsistency(image: EnvironmentImage): void {
  if (image.imageKind === 'derived-image' && image.buildDigest === null) {
    throw new EnvironmentError(ENVIRONMENT_ERROR_CODES.INVALID_IMAGE, {
      message:
        'a derived image must declare buildDigest (the digest of the build that produced it)',
      details: { imageKind: image.imageKind, digest: image.digest },
    });
  }
}
