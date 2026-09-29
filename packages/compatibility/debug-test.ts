import { isCompatibilityRecord } from './src/shared.js';

const testRecord = {
  recordVersion: 1,
  recordDigest: 'abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234',
  bodyVersionRef: 'body-1',
  substrateRef: 'substrate-1',
  evaluatedAt: new Date().toISOString(),
  verdict: 'compatible',
  reasons: [],
  details: {},
};

console.log('Test record:', JSON.stringify(testRecord, null, 2));
console.log('Is valid compatibility record:', isCompatibilityRecord(testRecord));

// Check each field individually
console.log('recordVersion === 1:', testRecord.recordVersion === 1);
console.log('typeof recordDigest === string:', typeof testRecord.recordDigest === 'string');
console.log('recordDigest length:', testRecord.recordDigest.length);
console.log('typeof bodyVersionRef === string:', typeof testRecord.bodyVersionRef === 'string');
console.log('typeof substrateRef === string:', typeof testRecord.substrateRef === 'string');
console.log('typeof evaluatedAt === string:', typeof testRecord.evaluatedAt === 'string');
console.log('typeof verdict === string:', typeof testRecord.verdict === 'string');
console.log('Array.isArray(reasons):', Array.isArray(testRecord.reasons));
console.log('typeof details === object:', typeof testRecord.details === 'object');
console.log('details !== null:', testRecord.details !== null);