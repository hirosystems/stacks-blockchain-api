import * as prom from 'prom-client';
import { normalizeHashString } from '../../helpers';
import { PgStore } from '../../datastore/pg-store';
import { logger } from '../../logger';
import { sha256 } from '@hirosystems/api-toolkit';
import { FastifyReply, FastifyRequest } from 'fastify';

/**
 * A `Cache-Control` header used for re-validation based caching.
 * * `public` == allow proxies/CDNs to cache as opposed to only local browsers.
 * * `no-cache` == clients can cache a resource but should revalidate each time before using it.
 * * `must-revalidate` == somewhat redundant directive to assert that cache must be revalidated, required by some CDNs
 */
const CACHE_CONTROL_MUST_REVALIDATE = 'public, no-cache, must-revalidate';

/**
 * Describes a key-value to be saved into a request's locals, representing the current
 * state of the chain depending on the type of information being requested by the endpoint.
 * This entry will have an `ETag` string as the value.
 */
enum ETagType {
  /** ETag based on the latest `index_block_hash` or `microblock_hash`. */
  chainTip = 'chain_tip',
  /** ETag based on a digest of all pending mempool `tx_id`s. */
  mempool = 'mempool',
  /** ETag based on the status of a single transaction across the mempool or canonical chain. */
  transaction = 'transaction',
}

/** Value that means the ETag did get calculated but it is empty. */
const ETAG_EMPTY = Symbol(-1);
type ETag = string | typeof ETAG_EMPTY;

interface ETagCacheMetrics {
  chainTipCacheHits: prom.Counter<string>;
  chainTipCacheMisses: prom.Counter<string>;
  chainTipCacheNoHeader: prom.Counter<string>;
  mempoolCacheHits: prom.Counter<string>;
  mempoolCacheMisses: prom.Counter<string>;
  mempoolCacheNoHeader: prom.Counter<string>;
}

let _eTagMetrics: ETagCacheMetrics | undefined;
function getETagMetrics(): ETagCacheMetrics {
  if (_eTagMetrics !== undefined) {
    return _eTagMetrics;
  }
  const metrics: ETagCacheMetrics = {
    chainTipCacheHits: new prom.Counter({
      name: 'chain_tip_cache_hits',
      help: 'Total count of requests with an up-to-date chain tip cache header',
    }),
    chainTipCacheMisses: new prom.Counter({
      name: 'chain_tip_cache_misses',
      help: 'Total count of requests with a stale chain tip cache header',
    }),
    chainTipCacheNoHeader: new prom.Counter({
      name: 'chain_tip_cache_no_header',
      help: 'Total count of requests that did not provide a chain tip header',
    }),
    mempoolCacheHits: new prom.Counter({
      name: 'mempool_cache_hits',
      help: 'Total count of requests with an up-to-date mempool cache header',
    }),
    mempoolCacheMisses: new prom.Counter({
      name: 'mempool_cache_misses',
      help: 'Total count of requests with a stale mempool cache header',
    }),
    mempoolCacheNoHeader: new prom.Counter({
      name: 'mempool_cache_no_header',
      help: 'Total count of requests that did not provide a mempool header',
    }),
  };
  _eTagMetrics = metrics;
  return _eTagMetrics;
}

/**
 * Parses the etag values from a raw `If-None-Match` request header value.
 * The wrapping double quotes (if any) and validation prefix (if any) are stripped.
 * The parsing is permissive to account for commonly non-spec-compliant clients, proxies, CDNs, etc.
 * E.g. the value:
 * ```js
 * `"a", W/"b", c,d,   "e", "f"`
 * ```
 * Would be parsed and returned as:
 * ```js
 * ['a', 'b', 'c', 'd', 'e', 'f']
 * ```
 * @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/If-None-Match#syntax
 * ```
 * If-None-Match: "etag_value"
 * If-None-Match: "etag_value", "etag_value", ...
 * If-None-Match: *
 * ```
 * @param ifNoneMatchHeaderValue - raw header value
 * @returns an array of etag values
 */
export function parseIfNoneMatchHeader(
  ifNoneMatchHeaderValue: string | undefined
): string[] | undefined {
  if (!ifNoneMatchHeaderValue) {
    return undefined;
  }
  // Strip wrapping double quotes like `"hello"` and the ETag validation-prefix like `W/"hello"`.
  // The API returns compliant, strong-validation ETags (double quoted ASCII), but can't control what
  // clients, proxies, CDNs, etc may provide.
  const normalized = /^(?:"|W\/")?(.*?)"?$/gi.exec(ifNoneMatchHeaderValue.trim())?.[1];
  if (!normalized) {
    // This should never happen unless handling a buggy request with something like `If-None-Match: ""`,
    // or if there's a flaw in the above code. Log warning for now.
    logger.warn(`Normalized If-None-Match header is falsy: ${ifNoneMatchHeaderValue}`);
    return undefined;
  } else if (normalized.includes(',')) {
    // Multiple etag values provided, likely irrelevant extra values added by a proxy/CDN.
    // Split on comma, also stripping quotes, weak-validation prefixes, and extra whitespace.
    return normalized.split(/(?:W\/"|")?(?:\s*),(?:\s*)(?:W\/"|")?/gi);
  } else {
    // Single value provided (the typical case)
    return [normalized];
  }
}

async function calculateETag(
  db: PgStore,
  etagType: ETagType,
  req: FastifyRequest
): Promise<ETag | undefined> {
  switch (etagType) {
    case ETagType.chainTip:
      try {
        const chainTip = await db.getChainTip(db.sql);
        if (chainTip.block_height === 0) {
          // This should never happen unless the API is serving requests before it has synced any
          // blocks.
          return;
        }
        return chainTip.microblock_hash ?? chainTip.index_block_hash;
      } catch (error) {
        logger.error(error, 'Unable to calculate chain_tip ETag');
        return;
      }

    case ETagType.mempool:
      try {
        const digest = await db.getMempoolTxDigest();
        if (!digest.found) {
          // This should never happen unless the API is serving requests before it has synced any
          // blocks.
          return;
        }
        if (digest.result.digest === null) {
          // A `null` mempool digest means the `bit_xor` postgres function is unavailable.
          return ETAG_EMPTY;
        }
        return digest.result.digest;
      } catch (error) {
        logger.error(error, 'Unable to calculate mempool');
        return;
      }

    case ETagType.transaction:
      try {
        const tx_id = (req.params as { tx_id: string }).tx_id;
        const normalizedTxId = normalizeHashString(tx_id);
        if (normalizedTxId === false) {
          return ETAG_EMPTY;
        }
        const status = await db.getTxStatus(normalizedTxId);
        if (!status.found) {
          return ETAG_EMPTY;
        }
        const elements: string[] = [
          normalizedTxId,
          status.result.index_block_hash ?? '',
          status.result.microblock_hash ?? '',
          status.result.status.toString(),
        ];
        return sha256(elements.join(':'));
      } catch (error) {
        logger.error(error, 'Unable to calculate transaction');
        return;
      }
  }
}

async function handleCache(type: ETagType, request: FastifyRequest, reply: FastifyReply) {
  const metrics = getETagMetrics();
  const ifNoneMatch = parseIfNoneMatchHeader(request.headers['if-none-match']);
  const etag = await calculateETag(request.server.db, type, request);
  switch (type) {
    case ETagType.chainTip:
      if (!ifNoneMatch) metrics.chainTipCacheNoHeader.inc();
      else if (etag && typeof etag === 'string' && ifNoneMatch.includes(etag))
        metrics.chainTipCacheHits.inc();
      else metrics.chainTipCacheMisses.inc();
      break;
    case ETagType.mempool:
      if (!ifNoneMatch) metrics.mempoolCacheNoHeader.inc();
      else if (etag && typeof etag === 'string' && ifNoneMatch.includes(etag))
        metrics.mempoolCacheHits.inc();
      else metrics.mempoolCacheMisses.inc();
      break;
    case ETagType.transaction:
      break;
  }
  if (etag) {
    if (ifNoneMatch && typeof etag === 'string' && ifNoneMatch.includes(etag)) {
      await reply.header('Cache-Control', CACHE_CONTROL_MUST_REVALIDATE).code(304).send();
    } else if (typeof etag === 'string') {
      void reply.headers({ 'Cache-Control': CACHE_CONTROL_MUST_REVALIDATE, ETag: `"${etag}"` });
    }
  }
}

export function handleChainTipCache(request: FastifyRequest, reply: FastifyReply) {
  return handleCache(ETagType.chainTip, request, reply);
}

export async function handleMempoolCache(request: FastifyRequest, reply: FastifyReply) {
  return handleCache(ETagType.mempool, request, reply);
}

export async function handleTransactionCache(request: FastifyRequest, reply: FastifyReply) {
  return handleCache(ETagType.transaction, request, reply);
}
