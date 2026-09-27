/**
 * Protocol versioning for @arena/model-substrate (Work Order A016).
 *
 * The package speaks ONE closed protocol surface version: records carry
 * recordVersion wire constants (see substrate.ts / adapter.ts /
 * registry.ts / compatibility.ts / upgrade.ts), payload schemas are
 * versioned SchemaRefs in the `model-substrate` namespace (see
 * envelopes.ts), and every AdapterDescriptor must declare EXACTLY this
 * protocol version — adapters built against a different surface are
 * rejected (MODEL_SUBSTRATE_UNSUPPORTED_VERSION), mirroring the core's
 * closed version policy ("unknown versions are rejected").
 */

/** Version of this package's protocol surface (records, schemas, adapter interface). */
export const MODEL_SUBSTRATE_PROTOCOL_VERSION = '1.0.0' as const;
