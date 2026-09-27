/**
 * CognitiveSubstrate tests: provider-neutral construction with ALL spec
 * AB1.0 identified fields, content-addressing (registry dedup), credential
 * rejection (gate 4 negative), provider-name rejection (gate 11 negative),
 * tamper detection and deep freeze.
 */

import { describe, expect, it } from 'vitest';
import { canonicalJson } from '@arena/protocol-core';
import { AgentBodyError } from './errors.js';
import { AGENT_BODY_ERROR_CODES } from './errors.js';
import {
  SUBSTRATE_MODALITIES,
  TOOL_CALLING_LEVELS,
  SUBSTRATE_CONDITIONS,
  cognitiveSubstrateDigest,
  createCognitiveSubstrate,
  isCognitiveSubstrate,
  verifyCognitiveSubstrate,
} from './substrate.js';
import { makeSubstrate, makeSubstrateInput } from './test-support.js';

describe('CognitiveSubstrate (positive)', () => {
  it('identifies all eight spec AB1.0 items', async () => {
    const substrate = await makeSubstrate();
    // 1. provider adapter
    expect(substrate.adapterId).toBe('adapter-reasoning-1');
    // 2. model family / id
    expect(substrate.modelFamily).toBe('reasoner');
    expect(substrate.modelId).toBe('reasoner-general-2');
    // 3. model revision
    expect(substrate.modelRevision).toBe('r7');
    // 4. modality profile
    expect(substrate.modalityProfile).toEqual(['text-input', 'text-output', 'structured-input']);
    // 5. tool-calling profile
    expect(TOOL_CALLING_LEVELS).toContain(substrate.toolCallingProfile);
    // 6. context / profile limits
    expect(substrate.contextLimits).toEqual({ maxContextUnits: 200000, maxOutputUnits: 32000 });
    // 7. adapter version
    expect(substrate.adapterVersion).toBe('1.4.0');
    // 8. integrity metadata
    expect(substrate.integrity.digestAlgorithm).toBe('sha256');
    expect(substrate.integrity.contentDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is structurally recognized and deeply frozen', async () => {
    const substrate = await makeSubstrate();
    expect(isCognitiveSubstrate(substrate)).toBe(true);
    expect(Object.isFrozen(substrate)).toBe(true);
    expect(Object.isFrozen(substrate.modalityProfile)).toBe(true);
    expect(Object.isFrozen(substrate.contextLimits)).toBe(true);
    expect(Object.isFrozen(substrate.integrity)).toBe(true);
  });

  it('registry-style dedup: same content ⇒ same digest; different content ⇒ different digest', async () => {
    const a = await makeSubstrate();
    const b = await makeSubstrate(); // identical input
    const c = await makeSubstrate({ modelRevision: 'r8' });
    expect(a.integrity.contentDigest).toBe(b.integrity.contentDigest);
    expect(await cognitiveSubstrateDigest(a)).toBe(a.integrity.contentDigest);
    expect(c.integrity.contentDigest).not.toBe(a.integrity.contentDigest);
  });

  it('verification recomputes the integrity digest', async () => {
    const substrate = await makeSubstrate();
    expect(await verifyCognitiveSubstrate(substrate)).toBe(substrate.integrity.contentDigest);
  });

  it('canonical serialization is provider-neutral', async () => {
    const substrate = await makeSubstrate();
    const serialized = canonicalJson(substrate);
    for (const banned of ['openai', 'anthropic', 'gpt-', 'claude', 'bearer', 'apiKey']) {
      expect(serialized).not.toContain(banned);
    }
  });
});

describe('CognitiveSubstrate (negative — construction fails closed)', () => {
  it('rejects credential-shaped fields (gate 4: apiKey, token, password, secret)', async () => {
    for (const field of ['apiKey', 'token', 'password', 'secret']) {
      const input = {
        ...makeSubstrateInput(),
        ...(field === 'apiKey' ? { apiKey: 'sk-0000000000' } : {}),
        ...(field === 'token' ? { token: 'tk-0000000000' } : {}),
        ...(field === 'password' ? { password: 'hunter22' } : {}),
        ...(field === 'secret' ? { secret: 'zzz' } : {}),
      };
      let thrown: unknown;
      try {
        await createCognitiveSubstrate(input as never);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(AgentBodyError);
      expect((thrown as AgentBodyError).code).toBe(
        AGENT_BODY_ERROR_CODES.SUBSTRATE_CREDENTIAL_REJECTED,
      );
    }
  });

  it('rejects nested credential-shaped fields', async () => {
    const input = { ...makeSubstrateInput(), contextLimits: { apiKey: 'x' } };
    await expect(createCognitiveSubstrate(input as never)).rejects.toThrow(
      /credential-shaped field/,
    );
  });

  it('rejects provider brand names in every identifier (gate 11)', async () => {
    for (const overrides of [
      { adapterId: 'adapter-openai-1' },
      { modelFamily: 'claude-family' },
      { modelId: 'gpt-4o-mini' },
      { modelRevision: 'anthropic-r1' },
    ]) {
      await expect(createCognitiveSubstrate(makeSubstrateInput(overrides))).rejects.toThrow(
        /provider brand name/,
      );
    }
  });

  it('rejects malformed neutral identifiers', async () => {
    await expect(createCognitiveSubstrate(makeSubstrateInput({ adapterId: 'BAD_ADAPTER' }))).rejects
      .toThrow(/adapter identifier/);
    await expect(
      createCognitiveSubstrate(makeSubstrateInput({ modelFamily: 'Family 1' })),
    ).rejects.toThrow(/model family/);
    await expect(createCognitiveSubstrate(makeSubstrateInput({ modelId: '' }))).rejects.toThrow(
      /model id/,
    );
    await expect(
      createCognitiveSubstrate(makeSubstrateInput({ modelRevision: 'rev!9' })),
    ).rejects.toThrow(/model revision/);
    await expect(
      createCognitiveSubstrate(makeSubstrateInput({ adapterVersion: '1.4.0+build' })),
    ).rejects.toThrow(/agent body version/);
  });

  it('rejects unknown modalities, tool-calling profiles and conditions', async () => {
    await expect(
      createCognitiveSubstrate(makeSubstrateInput({ modalityProfile: ['smell-input'] })),
    ).rejects.toThrow(/unknown substrate modality/);
    await expect(
      createCognitiveSubstrate(makeSubstrateInput({ toolCallingProfile: 'telepathy' })),
    ).rejects.toThrow(/tool-calling profile/);
    await expect(
      createCognitiveSubstrate(makeSubstrateInput({ conditions: ['on-fire'] })),
    ).rejects.toThrow(/unknown substrate condition/);
  });

  it('rejects empty modality profiles and duplicate modalities', async () => {
    await expect(createCognitiveSubstrate(makeSubstrateInput({ modalityProfile: [] }))).rejects
      .toThrow(/non-empty array/);
    await expect(
      createCognitiveSubstrate(makeSubstrateInput({ modalityProfile: ['text-input', 'text-input'] })),
    ).rejects.toThrow(/duplicate substrate modality/);
  });

  it('rejects malformed context limits', async () => {
    await expect(
      createCognitiveSubstrate(
        makeSubstrateInput({ contextLimits: { maxContextUnits: 0, maxOutputUnits: 10 } }),
      ),
    ).rejects.toThrow(/context limits/);
    await expect(
      createCognitiveSubstrate(
        makeSubstrateInput({ contextLimits: { maxContextUnits: 1.5, maxOutputUnits: 10 } }),
      ),
    ).rejects.toThrow(/context limits/);
  });
});

describe('CognitiveSubstrate tamper detection (fail closed)', () => {
  it('a mutated substrate fails verification', async () => {
    const substrate = await makeSubstrate();
    const tampered = {
      ...substrate,
      contextLimits: { maxContextUnits: 999999, maxOutputUnits: 32000 },
    };
    await expect(verifyCognitiveSubstrate(tampered)).rejects.toThrow(/integrity mismatch/);
    try {
      await verifyCognitiveSubstrate(tampered);
    } catch (error) {
      expect((error as AgentBodyError).code).toBe(AGENT_BODY_ERROR_CODES.TAMPERED);
    }
  });

  it('a structurally invalid value fails verification', async () => {
    await expect(verifyCognitiveSubstrate({} as never)).rejects.toThrow(
      /not a structurally valid cognitive substrate/,
    );
    expect(isCognitiveSubstrate({ recordVersion: 2 })).toBe(false);
  });
});

describe('closed vocabulary sanity', () => {
  it('exposes the closed enums used by contracts parity', () => {
    expect(SUBSTRATE_MODALITIES).toContain('text-input');
    expect(TOOL_CALLING_LEVELS).toEqual(['none', 'text-protocol', 'json-schema', 'function-calling']);
    expect(SUBSTRATE_CONDITIONS).toContain('deprecated');
  });
});
