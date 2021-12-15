/**
 * Util for testing chaintip-based http cache-control behavior with an API deployment
 * behind a CDN like Cloudflare.
 */

import fetch from 'node-fetch';
import * as assert from 'assert';

// To anyone looking in the future: this URL probably doesn't exist anymore. If everything
// went right, this could be pointed at the main API deployment URL instead, e.g.
// `https://stacks-node-api.stacks.co`
const TEST_URL = 'https://stacks-node-api-pr-877.stacks.co';

(async () => {
  const blockListUrl = new URL('/extended/v1/block', TEST_URL);

  // Fetch without any cache, i.e. no `if-none-match` header.
  const result1 = await fetch(blockListUrl);
  assert.equal(result1.status, 200, 'No cache headers provided, should be a 200 (no caching)');
  const etag = result1.headers.get('etag');
  assert.ok(etag, 'Response should contain etag header for cache-control');
  const cacheControl = result1.headers.get('cache-control');
  assert.equal(cacheControl, 'public, no-cache', 'Should have cache-control set');
  console.log(`[first request] cf-cache-status: ${result1.headers.get('cf-cache-status')}`)

  // Fetch simulating an http client with cache-control support, where the previous request was
  // cached as directed by the `cache-control` and `etag` response headers. So the `if-none-match`
  // header is set to the `etag` response of the previous request.
  // const result2 = await fetch(blockListUrl, { headers: { 'if-none-match': etag }});
  const result2 = await fetch(blockListUrl);
  assert.equal(result2.status, 304, 'Should have "304 Not Modified" result (cache hit)');
  assert.equal(result2.size, 0, 'Should have empty body cache hit');
  console.log(`[second request] cf-cache-status: ${result2.headers.get('cf-cache-status')}`)
})().catch(error => console.error(error));
