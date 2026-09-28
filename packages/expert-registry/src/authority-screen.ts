/**
 * The separation-of-concerns screen (Work Order A006 gate 3;
 * architecture-lock rule 9; §8: "Qualification, reputation and
 * authorization are separate concerns").
 *
 * An expert profile carries qualification DATA — competencies,
 * qualifications, evidence, history, reliability, availability,
 * domain/jurisdiction — but NEVER authorization grants and NEVER system
 * authority claims. Authorization is a separate future protocol (A034
 * security surface); nothing in this package grants, implies or records a
 * permission. The screen below is the machine enforcement of that
 * boundary: it walks every input object recursively and REJECTS any field
 * whose name is authority-shaped (`systemRole`, `authority`, `adminOf`,
 * `permissions`, `grantedScopes`, …) or PII-shaped (`email`, `phone`,
 * `legalName`, `dateOfBirth`, …).
 *
 * The screen is deliberately DETERMINISTIC: it matches normalized KEY
 * NAMES and DECLARED NAMES (domain-pack competency type ids, metadata
 * field names, competency domainType values and domainMetadata keys),
 * never free-text prose — a limitation statement is allowed to say "not
 * authorized to stamp drawings" because `statement` is a prose field, not
 * a declared permission. Value-level personal data cannot be fully
 * screened lexically (documented limitation); structural minimization
 * does the heavy lifting instead: identity is a neutral `expert-` prefixed
 * id, and locator charsets exclude email/phone shapes by construction
 * (see shared.ts NEUTRAL_LOCATOR_PATTERN_SOURCE).
 *
 * Key normalization: lowercase, then strip every non-alphanumeric
 * character — so `systemRole`, `system_role`, `SystemRole` and
 * `system-role` all normalize to `systemrole`.
 */

import { EXPERT_ERROR_CODES, ExpertRegistryError } from './errors.js';

/**
 * Authority vocabulary — SUBSTRING stems (normalized). A key containing
 * any stem is rejected: this catches the singular/plural/composed shapes
 * (`role`/`roles` are exact matches below because the bare stem `role`
 * would also hit `patrol`-style false positives).
 */
const AUTHORITY_KEY_STEMS = [
  'authorit', // authority, authoritative-authority claims
  'authoriz', // authorizedFor, authorization, preAuthorized
  'admin', // adminOf, isAdmin, administrator
  'permission',
  'privileg', // privilege, privileges, underprivileged? (accepted risk: not expert vocabulary)
  'entitle', // entitlements, entitledScopes
  'grant', // grants, grantedPermissions, grantor
  'superuser',
  'impersonat', // impersonation, mayImpersonate
  'accesslevel',
  'systemrole',
  'systemright',
  'mandate', // mandatedAuthority
  'clearance', // securityClearance
] as const;

/**
 * Authority vocabulary — EXACT normalized matches (stems too ambiguous for
 * substring matching).
 */
const AUTHORITY_KEY_EXACT = [
  'role',
  'roles',
  'scopes',
  'rights',
  'powers',
  'claims',
  'principals', // principal assignments are authorization data
  'actors',
] as const;

/**
 * PII vocabulary — EXACT normalized matches. Personal data has NO field on
 * an expert profile: identity is a neutral expert id plus DECLARED
 * identity refs (digest-addressed attestations held outside the profile).
 */
const PII_KEY_EXACT = [
  'name',
  'fullname',
  'legalname',
  'displayname',
  'nickname',
  'username',
  'givenname',
  'surname',
  'familyname',
  'email',
  'emailaddress',
  'mail',
  'phone',
  'phonenumber',
  'mobile',
  'mobilenumber',
  'telephone',
  'address',
  'homeaddress',
  'streetaddress',
  'dateofbirth',
  'dob',
  'birthdate',
  'nationalid',
  'nationalnumber',
  'socialsecuritynumber',
  'ssn',
  'passportnumber',
  'taxid',
  'vatnumber',
  'bankaccount',
  'iban',
  'creditcard',
  'creditcardnumber',
  'biometric',
  'photo',
  'avatar',
  'portrait',
] as const;

/** Normalize a key: lowercase, strip non-alphanumerics. */
export function normalizeScreenKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** True iff a normalized key is authority-shaped (stems OR exact set). */
export function isAuthorityKey(normalizedKey: string): boolean {
  if ((AUTHORITY_KEY_EXACT as readonly string[]).includes(normalizedKey)) return true;
  return AUTHORITY_KEY_STEMS.some((stem) => normalizedKey.includes(stem));
}

/** True iff a normalized key is PII-shaped (exact set). */
export function isPiiKey(normalizedKey: string): boolean {
  return (PII_KEY_EXACT as readonly string[]).includes(normalizedKey);
}

/** The vocabulary sources, exported for parity tests and documentation. */
export const AUTHORITY_SCREEN_STEMS: readonly string[] = [...AUTHORITY_KEY_STEMS];
export const AUTHORITY_SCREEN_EXACT: readonly string[] = [...AUTHORITY_KEY_EXACT];
export const PII_SCREEN_EXACT: readonly string[] = [...PII_KEY_EXACT];

// ---------------------------------------------------------------------------
// Declared-name screening (pack type ids, metadata field names, …)
// ---------------------------------------------------------------------------

/**
 * Screen a DECLARED NAME (a domain-pack competency type id, a pack metadata
 * field name, a competency's domainType value or a domainMetadata key):
 * authority-shaped and PII-shaped names are rejected exactly like keys. A
 * pack declaring a metadata field `adminOf` is an authority-injection
 * attempt (gate 8 negative); a competency carrying domainType `roles` is
 * the same attempt from the profile side.
 */
export function assertScreenedDeclaredName(name: string, what: string): void {
  const normalized = normalizeScreenKey(name);
  if (isAuthorityKey(normalized)) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.AUTHORITY_FIELD_REJECTED, {
      message: `${what} ${JSON.stringify(name)} is authority-shaped: expert profiles carry qualification data, never authorization or system authority (architecture-lock rule 9 — qualification, reputation and authorization are separate concerns; authorization is a separate future protocol)`,
      details: { screen: 'authority', field: name, normalized },
    });
  }
  if (isPiiKey(normalized)) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.PII_FIELD_REJECTED, {
      message: `${what} ${JSON.stringify(name)} is personal-data-shaped: expert identity is a neutral expert id plus declared identity refs — PII minimization (§8 identity)`,
      details: { screen: 'pii', field: name, normalized },
    });
  }
}

// ---------------------------------------------------------------------------
// Deep input screening
// ---------------------------------------------------------------------------

/**
 * Recursively screen every KEY of an input value (objects and arrays, any
 * depth) against the authority and PII vocabularies. Runs BEFORE field
 * validation, so a dangerous key is rejected even where the typed
 * validators would silently drop unknown keys. Cycle-safe via a seen-set.
 */
export function assertScreenedInput(value: unknown, what: string): void {
  const seen = new Set<unknown>();
  const walk = (node: unknown, path: string): void => {
    if (typeof node !== 'object' || node === null) return;
    if (seen.has(node)) return; // cycle guard
    seen.add(node);
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i += 1) {
        walk(node[i], `${path}[${i}]`);
      }
      return;
    }
    for (const key of Object.keys(node as Record<string, unknown>)) {
      const normalized = normalizeScreenKey(key);
      const at = path === '' ? key : `${path}.${key}`;
      if (isAuthorityKey(normalized)) {
        throw new ExpertRegistryError(
          EXPERT_ERROR_CODES.AUTHORITY_FIELD_REJECTED,
          {
            message: `${what} field ${JSON.stringify(at)} is authority-shaped: expert profiles carry qualification data, never authorization or system authority (architecture-lock rule 9 — qualification, reputation and authorization are separate concerns; authorization is a separate future protocol)`,
            details: { screen: 'authority', field: at, key },
          },
        );
      }
      if (isPiiKey(normalized)) {
        throw new ExpertRegistryError(EXPERT_ERROR_CODES.PII_FIELD_REJECTED, {
          message: `${what} field ${JSON.stringify(at)} is personal-data-shaped: expert identity is a neutral expert id plus declared identity refs — PII minimization (§8 identity)`,
          details: { screen: 'pii', field: at, key },
        });
      }
      walk((node as Record<string, unknown>)[key], at);
    }
  };
  walk(value, '');
}

/**
 * Assert that the screen itself is wired (self-test helper used by the
 * negative controls in the test suites): authority keys are caught, PII
 * keys are caught, protocol vocabulary is not.
 */
export function screenProbeKey(key: string): 'authority' | 'pii' | 'clean' {
  const normalized = normalizeScreenKey(key);
  if (isAuthorityKey(normalized)) return 'authority';
  if (isPiiKey(normalized)) return 'pii';
  return 'clean';
}
