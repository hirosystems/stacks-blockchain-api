# Stacks Blockchain API Best Practices

This guide covers best practices for integrating with and using the Stacks Blockchain API effectively.

## Table of Contents

1. [Rate Limiting and Caching](#rate-limiting-and-caching)
2. [Pagination Strategies](#pagination-strategies)
3. [Error Handling](#error-handling)
4. [Performance Optimization](#performance-optimization)
5. [Security Considerations](#security-considerations)
6. [Webhook Integration](#webhook-integration)

## Rate Limiting and Caching

### Implement Client-Side Rate Limiting

```typescript
class RateLimitedClient {
  private requestQueue: Array<() => Promise<any>> = [];
  private processing = false;
  private readonly maxRequestsPerSecond = 10;

  async request<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.requestQueue.push(async () => {
        try {
          const result = await fn();
          resolve(result);
        } catch (e) {
          reject(e);
        }
      });
      this.processQueue();
    });
  }

  private async processQueue() {
    if (this.processing) return;
    this.processing = true;

    while (this.requestQueue.length > 0) {
      const fn = this.requestQueue.shift();
      if (fn) await fn();
      await new Promise(r => setTimeout(r, 1000 / this.maxRequestsPerSecond));
    }

    this.processing = false;
  }
}
```

### Cache Frequently Accessed Data

```typescript
interface CacheEntry<T> {
  data: T;
  expiry: number;
}

class APICache {
  private cache = new Map<string, CacheEntry<any>>();

  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiry) {
      this.cache.delete(key);
      return null;
    }
    return entry.data;
  }

  set<T>(key: string, data: T, ttlSeconds: number): void {
    this.cache.set(key, {
      data,
      expiry: Date.now() + ttlSeconds * 1000
    });
  }
}

// Usage for block info (changes every ~10 minutes)
const blockCache = new APICache();
async function getBlockInfo(height: number) {
  const cacheKey = `block:${height}`;
  const cached = blockCache.get(cacheKey);
  if (cached) return cached;

  const response = await fetch(`/extended/v1/block/by_height/${height}`);
  const data = await response.json();
  
  // Cache finalized blocks longer
  const ttl = data.canonical ? 3600 : 60;
  blockCache.set(cacheKey, data, ttl);
  return data;
}
```

## Pagination Strategies

### Cursor-Based Pagination

For large datasets, use cursor-based pagination for consistent results:

```typescript
async function* fetchAllTransactions(
  address: string
): AsyncGenerator<Transaction[]> {
  let offset = 0;
  const limit = 50;
  
  while (true) {
    const response = await fetch(
      `/extended/v1/address/${address}/transactions?offset=${offset}&limit=${limit}`
    );
    const data = await response.json();
    
    if (data.results.length === 0) break;
    
    yield data.results;
    
    if (data.results.length < limit) break;
    offset += limit;
  }
}

// Usage
for await (const batch of fetchAllTransactions('SP...')) {
  processBatch(batch);
}
```

### Parallel Fetching with Rate Control

```typescript
async function fetchMultipleAddresses(
  addresses: string[],
  concurrency = 5
): Promise<Map<string, AddressBalance>> {
  const results = new Map<string, AddressBalance>();
  const chunks = chunkArray(addresses, concurrency);
  
  for (const chunk of chunks) {
    const promises = chunk.map(async (addr) => {
      const response = await fetch(`/extended/v1/address/${addr}/balances`);
      const data = await response.json();
      results.set(addr, data);
    });
    
    await Promise.all(promises);
    await sleep(200); // Brief pause between batches
  }
  
  return results;
}
```

## Error Handling

### Implement Robust Retry Logic

```typescript
interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  retryableStatuses: number[];
}

async function fetchWithRetry<T>(
  url: string,
  config: RetryConfig = {
    maxRetries: 3,
    baseDelayMs: 1000,
    maxDelayMs: 30000,
    retryableStatuses: [429, 500, 502, 503, 504]
  }
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      const response = await fetch(url);

      if (response.ok) {
        return await response.json();
      }

      if (!config.retryableStatuses.includes(response.status)) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      lastError = new Error(`HTTP ${response.status}`);
    } catch (e) {
      lastError = e as Error;
    }

    if (attempt < config.maxRetries) {
      const delay = Math.min(
        config.baseDelayMs * Math.pow(2, attempt),
        config.maxDelayMs
      );
      const jitter = delay * 0.1 * Math.random();
      await sleep(delay + jitter);
    }
  }

  throw lastError;
}
```

### Handle Chain Reorganizations

```typescript
interface TransactionStatus {
  confirmed: boolean;
  confirmations: number;
  canonical: boolean;
}

async function waitForConfirmation(
  txId: string,
  requiredConfirmations = 6,
  timeoutMs = 600000
): Promise<TransactionStatus> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const response = await fetch(`/extended/v1/tx/${txId}`);
    const tx = await response.json();

    if (tx.tx_status === 'success' && tx.canonical) {
      const tipResponse = await fetch('/extended/v1/block');
      const tip = await tipResponse.json();
      const confirmations = tip.height - tx.block_height + 1;

      if (confirmations >= requiredConfirmations) {
        return {
          confirmed: true,
          confirmations,
          canonical: true
        };
      }
    }

    // Check for dropped/replaced transactions
    if (tx.tx_status === 'dropped_replace_by_fee' ||
        tx.tx_status === 'dropped_stale_garbage_collect') {
      throw new Error(`Transaction dropped: ${tx.tx_status}`);
    }

    await sleep(10000); // Check every 10 seconds
  }

  throw new Error('Confirmation timeout');
}
```

## Performance Optimization

### Use Appropriate Endpoints

```typescript
// Instead of fetching full transaction details for balance checks
// ❌ Inefficient
async function getBalanceSlow(address: string) {
  const txs = await fetch(`/extended/v1/address/${address}/transactions`);
  // Process all transactions to calculate balance
}

// ✅ Efficient - use dedicated balance endpoint
async function getBalanceFast(address: string) {
  const response = await fetch(`/extended/v1/address/${address}/stx`);
  return response.json();
}
```

### Batch Contract Calls

```typescript
// For multiple read-only contract calls, use batch endpoint
async function batchContractReads(
  calls: Array<{
    contractAddress: string;
    contractName: string;
    functionName: string;
    functionArgs: string[];
  }>
): Promise<any[]> {
  const response = await fetch('/v2/contracts/call-read/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ calls })
  });
  return response.json();
}
```

### Subscribe to Events Instead of Polling

```typescript
// Use WebSocket for real-time updates
function subscribeToAddress(address: string, onUpdate: (data: any) => void) {
  const ws = new WebSocket('wss://api.mainnet.hiro.so/');
  
  ws.onopen = () => {
    ws.send(JSON.stringify({
      type: 'subscribe',
      channel: 'address',
      address
    }));
  };

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    onUpdate(data);
  };

  return () => ws.close();
}
```

## Security Considerations

### Validate All Responses

```typescript
import { z } from 'zod';

const TransactionSchema = z.object({
  tx_id: z.string().regex(/^0x[a-f0-9]{64}$/),
  tx_status: z.enum(['pending', 'success', 'abort_by_response', 'abort_by_post_condition']),
  sender_address: z.string().startsWith('SP'),
  fee_rate: z.string(),
  nonce: z.number().int().nonnegative(),
});

async function getTransaction(txId: string) {
  const response = await fetch(`/extended/v1/tx/${txId}`);
  const data = await response.json();
  
  // Validate response structure
  const validated = TransactionSchema.parse(data);
  return validated;
}
```

### Verify Contract Deployments

```typescript
async function verifyContract(
  contractId: string,
  expectedCodeHash: string
): Promise<boolean> {
  const response = await fetch(`/v2/contracts/source/${contractId}`);
  const data = await response.json();
  
  // Hash the source code
  const encoder = new TextEncoder();
  const sourceBytes = encoder.encode(data.source);
  const hashBuffer = await crypto.subtle.digest('SHA-256', sourceBytes);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  
  return hashHex === expectedCodeHash;
}
```

## Webhook Integration

### Set Up Transaction Monitoring

```typescript
// Express.js webhook handler
import express from 'express';
import crypto from 'crypto';

const app = express();

app.post('/webhook/transactions', express.json(), (req, res) => {
  // Verify webhook signature
  const signature = req.headers['x-stacks-signature'];
  const payload = JSON.stringify(req.body);
  const expectedSignature = crypto
    .createHmac('sha256', process.env.WEBHOOK_SECRET!)
    .update(payload)
    .digest('hex');

  if (signature !== expectedSignature) {
    return res.status(401).send('Invalid signature');
  }

  const { type, payload: txPayload } = req.body;

  switch (type) {
    case 'transaction':
      handleTransaction(txPayload);
      break;
    case 'block':
      handleBlock(txPayload);
      break;
  }

  res.status(200).send('OK');
});
```

## Additional Resources

- [API Reference Documentation](https://docs.hiro.so/stacks-blockchain-api)
- [Stacks.js SDK](https://stacks.js.org/)
- [Hiro Platform](https://platform.hiro.so/)

---

*This guide is maintained by the community. Contributions welcome!*
