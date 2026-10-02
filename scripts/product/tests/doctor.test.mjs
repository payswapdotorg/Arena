/**
 * Deterministic tests for the doctor diagnosis logic (Work Order B016).
 * All probes are injected fakes — the logic is exercised deterministically.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  doctorExitCode,
  renderDoctorReport,
  runDoctorChecks,
} from '../lib/doctor-logic.mjs';

const CORPUS_RECORD = {
  recordId: 'demo.agent-body.software-engineer',
  tenantId: 'arena-demo',
  kind: 'agent-body',
  version: 1,
  revision: 1,
  data: { displayName: 'Software Engineer (reference body)' },
  createdAt: 1770000000,
  updatedAt: 1770000000,
};

function makeProbes(overrides = {}) {
  return {
    nodeVersion: () => 'v22.21.1',
    enginesText: () => '>=22 <23',
    packageManagerPin: () => 'pnpm@10.34.5',
    pnpmVersion: () => '10.34.5',
    corepackVersion: () => '1.3.2',
    diskFreeBytes: () => 8 * 1024 * 1024 * 1024,
    installPresent: () => true,
    buildPresent: () => true,
    storeSnapshot: () => ({ status: 'absent' }),
    corpusRecords: () => [CORPUS_RECORD],
    canonicalEqual: (left, right) => JSON.stringify(left) === JSON.stringify(right),
    demoTenantId: () => 'arena-demo',
    webPortOpen: () => false,
    webPortUrl: () => 'http://localhost:3000',
    ...overrides,
  };
}

function byId(results) {
  const map = new Map();
  for (const result of results) map.set(result.id, result);
  return map;
}

test('a healthy environment is all-pass with exit code 0', () => {
  const records = new Map([[CORPUS_RECORD.recordId, CORPUS_RECORD]]);
  const results = runDoctorChecks(
    makeProbes({
      storeSnapshot: () => ({
        status: 'ok',
        recordCount: 1,
        recordIds: [CORPUS_RECORD.recordId],
        tenantCounts: { 'arena-demo': 1 },
        records,
      }),
      webPortOpen: () => true,
    }),
  );
  assert.equal(results.every((r) => r.status === 'pass'), true);
  assert.equal(doctorExitCode(results), 0);
  const rendered = renderDoctorReport(results).join('\n');
  assert.match(rendered, /store: local fake persistence store healthy/);
  assert.match(rendered, /byte-identical/);
  assert.match(rendered, /web dev server listening/);
});

test('node out of range fails with an actionable fix', () => {
  const results = runDoctorChecks(makeProbes({ nodeVersion: () => 'v24.1.0' }));
  const node = byId(results).get('node');
  assert.equal(node.status, 'fail');
  assert.match(node.next, /nvm install 22|nodejs\.org/);
  assert.equal(doctorExitCode(results), 1);
});

test('missing pnpm fails with the corepack next action', () => {
  const results = runDoctorChecks(makeProbes({ pnpmVersion: () => null }));
  const pnpm = byId(results).get('pnpm');
  assert.equal(pnpm.status, 'fail');
  assert.match(pnpm.next, /corepack enable/);
});

test('not installed / not built are actionable and distinguish fail from warn', () => {
  const results = runDoctorChecks(
    makeProbes({ installPresent: () => false, buildPresent: () => false }),
  );
  const by = byId(results);
  assert.equal(by.get('install').status, 'fail');
  assert.match(by.get('install').next, /install\.mjs/);
  assert.equal(by.get('build').status, 'warn');
  assert.match(by.get('build').next, /install\.mjs/);
  assert.equal(doctorExitCode(results), 1);
});

test('absent store is a warning (the web demo route works without it)', () => {
  const results = runDoctorChecks(makeProbes());
  const store = byId(results).get('store');
  assert.equal(store.status, 'warn');
  assert.match(store.next, /seed\.mjs/);
  assert.equal(doctorExitCode(results), 0);
});

test('corrupt store FAILS with the reset+reseed next action', () => {
  const results = runDoctorChecks(
    makeProbes({ storeSnapshot: () => ({ status: 'corrupt', reason: 'not valid JSON (oops)' }) }),
  );
  const store = byId(results).get('store');
  assert.equal(store.status, 'fail');
  assert.match(store.summary, /CORRUPT/);
  assert.match(store.next, /reset\.mjs --yes/);
  assert.equal(doctorExitCode(results), 1);
});

test('store divergence from the corpus warns with the reset+reseed path', () => {
  const diverged = { ...CORPUS_RECORD, data: { displayName: 'tampered' } };
  const records = new Map([[diverged.recordId, diverged]]);
  const results = runDoctorChecks(
    makeProbes({
      storeSnapshot: () => ({
        status: 'ok',
        recordCount: 1,
        recordIds: [diverged.recordId],
        tenantCounts: { 'arena-demo': 1 },
        records,
      }),
    }),
  );
  const store = byId(results).get('store');
  assert.equal(store.status, 'warn');
  assert.match(store.summary, /diverges from the deterministic demo corpus/);
  assert.match(store.next, /reset\.mjs --yes --reseed/);
});

test('missing corpus records count as divergence', () => {
  const results = runDoctorChecks(
    makeProbes({
      storeSnapshot: () => ({
        status: 'ok',
        recordCount: 0,
        recordIds: [],
        tenantCounts: {},
        records: new Map(),
      }),
    }),
  );
  const store = byId(results).get('store');
  assert.equal(store.status, 'warn');
  assert.match(store.summary, /missing demo\.agent-body\.software-engineer/);
});

test('non-demo tenants in the store surface as their own warning', () => {
  const records = new Map([
    [CORPUS_RECORD.recordId, CORPUS_RECORD],
    ['other.record', { ...CORPUS_RECORD, recordId: 'other.record', tenantId: 'other-tenant' }],
  ]);
  const results = runDoctorChecks(
    makeProbes({
      storeSnapshot: () => ({
        status: 'ok',
        recordCount: 2,
        recordIds: [CORPUS_RECORD.recordId, 'other.record'],
        tenantCounts: { 'arena-demo': 1, 'other-tenant': 1 },
        records,
      }),
    }),
  );
  const by = byId(results);
  assert.equal(by.get('store-tenants').status, 'warn');
  assert.match(by.get('store-tenants').summary, /OUTSIDE the demo tenant/);
  assert.equal(by.get('store').status, 'pass');
});

test('workspace modules unavailable degrades the store check honestly', () => {
  const records = new Map([[CORPUS_RECORD.recordId, CORPUS_RECORD]]);
  const results = runDoctorChecks(
    makeProbes({
      corpusRecords: () => null,
      canonicalEqual: null,
      storeSnapshot: () => ({
        status: 'ok',
        recordCount: 1,
        recordIds: [CORPUS_RECORD.recordId],
        tenantCounts: { 'arena-demo': 1 },
        records,
      }),
    }),
  );
  const store = byId(results).get('store');
  assert.equal(store.status, 'warn');
  assert.match(store.summary, /corpus could not be loaded/);
});

test('unreadable root manifest fails both node and pnpm checks honestly', () => {
  const results = runDoctorChecks(
    makeProbes({ enginesText: () => null, packageManagerPin: () => null }),
  );
  const by = byId(results);
  assert.equal(by.get('node').status, 'fail');
  assert.match(by.get('node').summary, /package\.json is unreadable/);
  assert.equal(by.get('pnpm').status, 'fail');
});

test('disk probe failure fails the disk check', () => {
  const results = runDoctorChecks(makeProbes({ diskFreeBytes: () => null }));
  const disk = byId(results).get('disk');
  assert.equal(disk.status, 'fail');
  assert.match(disk.summary, /could not read free disk space/);
});

test('renderDoctorReport includes the verdict line and next actions', () => {
  const records = new Map([[CORPUS_RECORD.recordId, CORPUS_RECORD]]);
  const results = runDoctorChecks(
    makeProbes({
      storeSnapshot: () => ({
        status: 'ok',
        recordCount: 1,
        recordIds: [CORPUS_RECORD.recordId],
        tenantCounts: { 'arena-demo': 1 },
        records,
      }),
    }),
  );
  const rendered = renderDoctorReport(results);
  const verdict = rendered.find((line) => line.startsWith('[arena-doctor] verdict:'));
  assert.notEqual(verdict, undefined);
  assert.match(verdict, /pass · \d+ warn · 0 fail/);
  assert.ok(rendered.some((line) => line.includes('next:')), 'warnings carry next actions');
});
