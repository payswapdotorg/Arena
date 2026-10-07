import type { Metadata } from 'next';

import { resolveDevelopersSandboxExperience } from '../../../developers/index.js';

export const metadata: Metadata = {
  title: 'Sandbox console',
};

/**
 * /developers/sandbox — the sandbox console: canned deterministic
 * escalation runs and the arriving lifecycle events, visibly labelled
 * (Work Order C017). Fail closed.
 */
export default async function DevelopersSandboxPage() {
  const experience = await resolveDevelopersSandboxExperience();
  return experience.view;
}
