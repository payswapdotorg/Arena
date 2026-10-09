/**
 * @arena/webhook-delivery — the Arena signed webhook delivery service
 * (Work Order P003; issue #155; ADR-P001-08 rule 4 + ADR-P001-01).
 *
 * Public surface:
 *   service        — createWebhookDeliveryService (the drain surface over
 *                    the durable outbox + the existing adapter contract)
 *   http-transport — the REAL node fetch transport with bounded timeouts
 *   ledger         — the reference (process-local) delivery ledger
 *   loop           — the dedicated drain loop (honestly disclosed: the
 *                    frozen host job-kind registry cannot register
 *                    webhook-delivery kinds — TL follow-up recorded)
 */

export * from './service.js';
export * from './http-transport.js';
export * from './ledger.js';
export * from './loop.js';
