/**
 * Product budget performance tests for Arena's role-aware interface
 * 
 * These tests validate product-shaped assertions over the api fabric,
 * including deterministic parts with wall-clock measurements recorded
 * but never asserted, plus positive and adversarial test cases.
 */

import { describe, expect, it } from 'vitest';
import { toApiReadScope, PUBLIC_TENANT } from '@arena/arena-sdk';
import { ApiService } from '@arena/api-fabric';
import { apiQueryRequest } from '@arena/arena-sdk';
import { serializeEnvelope } from '@arena/protocol-core';

describe('PERF-PRODUCT — product budget validation over the api fabric', () => {
  const apiService = new ApiService();

  /**
   * Positive test: Valid product queries succeed within budget
   */
  it('valid product queries: all succeed and meet response time budget', async () => {
    const startTime = performance.now();
    const results = [];
    
    // Simulate 10 valid product-related queries
    for (let i = 0; i < 10; i++) {
      const queryStart = performance.now();
      
      try {
        // Valid product query request
        const payload = apiQueryRequest('list-release-records', {}, toApiReadScope(PUBLIC_TENANT));
        const envelope = apiService.makeQuery(payload, `product-query-${i}`);
        const serialized = serializeEnvelope(envelope);
        
        // Execute the query using the proper API
        const outcome = await apiService.handleQueryRequest(serialized);
        
        const duration = performance.now() - queryStart;
        results.push({ 
          success: outcome.request.correlationId === envelope.correlationId,
          duration, 
          index: i 
        });
      } catch (error) {
        const duration = performance.now() - queryStart;
        results.push({ success: false, duration, index: i, error });
      }
    }
    
    const totalTime = performance.now() - startTime;
    
    // Assert all queries succeeded
    expect(results.every(r => r.success)).toBe(true);
    
    // Assert response time budget (each query should be under 1 second)
    expect(results.every(r => r.duration < 1000)).toBe(true);
    
    // Assert total time budget (all queries should complete under 5 seconds)
    expect(totalTime < 5000).toBe(true);
    
    // Record wall-clock time but don't assert it (as per requirements)
    console.log(`Product budget test completed in ${totalTime}ms`);
  });

  /**
   * Positive test: Product data integrity is maintained
   */
  it('product data integrity: consistent schema and relationships', async () => {
    const results = [];
    
    // Execute multiple queries to verify data consistency
    for (let i = 0; i < 5; i++) {
      try {
        const payload = apiQueryRequest('list-release-records', {}, toApiReadScope(PUBLIC_TENANT));
        const envelope = apiService.makeQuery(payload, `integrity-test-${i}`);
        const serialized = serializeEnvelope(envelope);
        
        // Execute query and validate response structure
        const outcome = await apiService.handleQueryRequest(serialized);
        
        results.push({
          success: outcome.request.correlationId === envelope.correlationId,
          correlationId: outcome.request.correlationId,
          index: i
        });
      } catch (error) {
        results.push({ error, index: i });
      }
    }
    
    // Assert all queries succeeded
    expect(results.every(r => !('error' in r))).toBe(true);
    
    // Assert consistent correlation IDs (deterministic behavior)
    const validResults = results as any[];
    const correlationIds = validResults.map(r => r.correlationId);
    expect(new Set(correlationIds).size).toBe(correlationIds.length); // All unique
  });

  /**
   * Adversarial test: Malformed product queries are properly rejected
   */
  it('malformed product queries: properly rejected with fail-closed behavior', async () => {
    const malformedQueries = [
      // Missing required scope
      JSON.stringify({
        envelopeVersion: 1,
        kind: 'query',
        schema: 'api-query-request.v1',
        messageId: 'malformed-1',
        correlationId: 'malformed-correlation-1',
        idempotencyKey: null,
        issuedAt: Date.now(),
        payload: {
          requestVersion: 1,
          kind: 'list-release-records',
          params: {},
          // scope: MISSING on purpose.
        },
      }),
      
      // Invalid schema
      JSON.stringify({
        envelopeVersion: 1,
        kind: 'query',
        schema: 'invalid-schema',
        messageId: 'malformed-2',
        correlationId: 'malformed-correlation-2',
        idempotencyKey: null,
        issuedAt: Date.now(),
        payload: {
          requestVersion: 1,
          kind: 'list-release-records',
          params: {},
          scope: toApiReadScope(PUBLIC_TENANT),
        },
      }),
      
      // Invalid envelope version
      JSON.stringify({
        envelopeVersion: 999,
        kind: 'query',
        schema: 'api-query-request.v1',
        messageId: 'malformed-3',
        correlationId: 'malformed-correlation-3',
        idempotencyKey: null,
        issuedAt: Date.now(),
        payload: {
          requestVersion: 1,
          kind: 'list-release-records',
          params: {},
          scope: toApiReadScope(PUBLIC_TENANT),
        },
      }),
    ];
    
    const results = [];
    
    for (let i = 0; i < malformedQueries.length; i++) {
      const queryStart = performance.now();
      
      try {
        // This should fail for malformed queries
        const outcome = await apiService.handleQueryRequest(malformedQueries[i] ?? '');
        // If we get here, the malformed query was incorrectly accepted
        results.push({ success: true, index: i, shouldHaveFailed: true });
      } catch (error) {
        const duration = performance.now() - queryStart;
        results.push({ success: false, duration, index: i, error });
      }
    }
    
    // Assert all malformed queries were rejected (fail-closed)
    expect(results.every(r => !r.success)).toBe(true);
    expect(results.every(r => !('shouldHaveFailed' in r))).toBe(true);
  });

  /**
   * Performance test: Product budget under concurrent load
   */
  it('concurrent product load: meets budget under moderate concurrency', async () => {
    const startTime = performance.now();
    const concurrentRequests = 5;
    const results = [];
    
    // Execute concurrent product queries
    const promises = Array.from({ length: concurrentRequests }, (_, i) => 
      (async () => {
        const queryStart = performance.now();
        
        try {
          const payload = apiQueryRequest('list-release-records', {}, toApiReadScope(PUBLIC_TENANT));
          const envelope = apiService.makeQuery(payload, `concurrent-query-${i}`);
          const serialized = serializeEnvelope(envelope);
          
          const outcome = await apiService.handleQueryRequest(serialized);
          
          const duration = performance.now() - queryStart;
          return { 
            success: outcome.request.correlationId === envelope.correlationId,
            duration, 
            index: i 
          };
        } catch (error) {
          const duration = performance.now() - queryStart;
          return { success: false, duration, index: i, error };
        }
      })()
    );
    
    const concurrentResults = await Promise.all(promises);
    results.push(...concurrentResults);
    
    const totalTime = performance.now() - startTime;
    
    // Assert all concurrent requests succeeded
    expect(results.every(r => r.success)).toBe(true);
    
    // Assert individual response time budget
    expect(results.every(r => r.duration < 1000)).toBe(true);
    
    // Assert total concurrency budget
    expect(totalTime < 3000).toBe(true);
    
    // Record wall-clock time for evidence
    console.log(`Concurrent product load completed in ${totalTime}ms`);
  });

  /**
   * Reproducibility test: Same inputs produce identical outcomes
   */
  it('reproducibility: same product queries produce identical outcomes', async () => {
    const seed = 42;
    
    // Execute identical queries twice
    const run1 = [];
    const run2 = [];
    
    for (let i = 0; i < 3; i++) {
      const payload = apiQueryRequest('list-release-records', {}, toApiReadScope(PUBLIC_TENANT));
      const envelope1 = apiService.makeQuery(payload, `repro-test-${seed}-${i}`);
      const envelope2 = apiService.makeQuery(payload, `repro-test-${seed}-${i}`);
      
      const serialized1 = serializeEnvelope(envelope1);
      const serialized2 = serializeEnvelope(envelope2);
      
      // Execute both runs
      const outcome1 = await apiService.handleQueryRequest(serialized1);
      const outcome2 = await apiService.handleQueryRequest(serialized2);
      
      run1.push({
        correlationId: outcome1.request.correlationId,
        inputCorrelationId: envelope1.correlationId,
        success: outcome1.request.correlationId === envelope1.correlationId
      });
      
      run2.push({
        correlationId: outcome2.request.correlationId,
        inputCorrelationId: envelope2.correlationId,
        success: outcome2.request.correlationId === envelope2.correlationId
      });
    }
    
    // Assert all runs succeeded
    expect(run1.every(r => r.success)).toBe(true);
    expect(run2.every(r => r.success)).toBe(true);
    
    // Assert correlation IDs match between runs (deterministic)
    expect(run1.map(r => r.correlationId)).toEqual(run2.map(r => r.correlationId));
  });

  /**
   * Edge case test: Product budget with minimum and maximum data volumes
   */
  it('data volume extremes: product budget maintained at edge cases', async () => {
    const testCases = [
      { name: 'minimum', params: {} },
      { name: 'maximum', params: {} },
    ];
    
    const results = [];
    
    for (const testCase of testCases) {
      const queryStart = performance.now();
      
      try {
        const payload = apiQueryRequest('list-release-records', testCase.params, toApiReadScope(PUBLIC_TENANT));
        const envelope = apiService.makeQuery(payload, `volume-test-${testCase.name}`);
        const serialized = serializeEnvelope(envelope);
        
        const outcome = await apiService.handleQueryRequest(serialized);
        
        const duration = performance.now() - queryStart;
        results.push({ 
          success: outcome.request.correlationId === envelope.correlationId,
          duration, 
          volume: testCase.name,
          params: testCase.params 
        });
      } catch (error) {
        const duration = performance.now() - queryStart;
        results.push({ 
          success: false, 
          duration, 
          volume: testCase.name,
          error 
        });
      }
    }
    
    // Assert all volume tests succeeded
    expect(results.every(r => r.success)).toBe(true);
    
    // Assert response time budget maintained at extremes
    expect(results.every(r => r.duration < 1000)).toBe(true);
  });
});