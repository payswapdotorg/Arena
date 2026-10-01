/**
 * Regenerates src/tokens/tokens.css from the typed token registry.
 *
 * Run from the repository root or the package directory:
 *
 *   pnpm --filter @arena/ui-platform tokens:css
 */

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { generateTokensCss } from '../src/tokens/tokens.ts';

const packageDir = fileURLToPath(new URL('..', import.meta.url));
const target = `${packageDir}src/tokens/tokens.css`;

writeFileSync(target, generateTokensCss(), 'utf-8');
console.log(`[ui-platform] wrote ${target}`);
