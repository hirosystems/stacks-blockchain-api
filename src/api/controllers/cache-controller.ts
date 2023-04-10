import { RequestHandler, Request, Response } from 'express';
import * as prom from 'prom-client';
import { logger, normalizeHashString, sha256 } from '../../helpers';
import { asyncHandler } from '../async-handler';
import { PgStore } from '../../datastore/pg-store';

const CACHE_OK = Symbol('cache_ok');

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
export enum ETagType {
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

export function setResponseNonCacheable(res: Response) {
  res.removeHeader('Cache-Control');
  res.removeHeader('ETag');
}

/**
 * Sets the response `Cache-Control` and `ETag` headers using the etag previously added
 * to the response locals.
 */
export function setETagCacheHeaders(res: Response, etagType: ETagType = ETagType.chainTip) {
  const etag: ETag | undefined = res.locals[etagType];
  if (!etag) {
    logger.error(
      `Cannot set cache control headers, no etag was set on \`Response.locals[${etagType}]\`.`
    );
    return;
  }
  if (etag === ETAG_EMPTY) {
    return;
  }
  res.set({
    'Cache-Control': CACHE_CONTROL_MUST_REVALIDATE,
    // Use the current chain tip or mempool state as the etag so that cache is invalidated on new blocks or
    // new mempool events.
    // This value will be provided in the `If-None-Match` request header in subsequent requests.
    // See https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/ETag
    // > Entity tag that uniquely represents the requested resource.
    // > It is a string of ASCII characters placed between double quotes..
    ETag: `"${etag}"`,
  });
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

/**
 * Parse the `ETag` from the given request's `If-None-Match` header which represents the chain tip or
 * mempool state associated with the client's cached response. Query the current state from the db, and
 * compare the two.
 * This function is also responsible for tracking the prometheus metrics associated with cache hits/misses.
 * @returns `CACHE_OK` if the client's cached response is up-to-date with the current state, otherwise,
 * returns a string which can be used later for setting the cache control `ETag` response header.
 */
async function checkETagCacheOK(
  db: PgStore,
  req: Request,
  etagType: ETagType
): Promise<ETag | undefined | typeof CACHE_OK> {
  const metrics = getETagMetrics();
  const etag = await calculateETag(db, etagType, req);
  if (!etag || etag === ETAG_EMPTY) {
    return;
  }
  // Parse ETag values from the request's `If-None-Match` header, if any.
  // Note: node.js normalizes `IncomingMessage.headers` to lowercase.
  const ifNoneMatch = parseIfNoneMatchHeader(req.headers['if-none-match']);
  if (ifNoneMatch === undefined || ifNoneMatch.length === 0) {
    // No if-none-match header specified.
    if (etagType === ETagType.chainTip) {
      metrics.chainTipCacheNoHeader.inc();
    } else {
      metrics.mempoolCacheNoHeader.inc();
    }
    return etag;
  }
  if (ifNoneMatch.includes(etag)) {
    // The client cache's ETag matches the current state, so no need to re-process the request
    // server-side as there will be no change in response. Record this as a "cache hit" and return CACHE_OK.
    if (etagType === ETagType.chainTip) {
      metrics.chainTipCacheHits.inc();
    } else {
      metrics.mempoolCacheHits.inc();
    }
    return CACHE_OK;
  } else {
    // The client cache's ETag is associated with an different block than current latest state, typically
    // an older block or a forked block, so the client's cached response is stale and should not be used.
    // Record this as a "cache miss" and return the current state.
    if (etagType === ETagType.chainTip) {
      metrics.chainTipCacheMisses.inc();
    } else {
      metrics.mempoolCacheMisses.inc();
    }
    return etag;
  }
}

/**
 * Check if the request has an up-to-date cached response by comparing the `If-None-Match` request header to the
 * current state. If the cache is valid then a `304 Not Modified` response is sent and the route handling for
 * this request is completed. If the cache is outdated, the current state is added to the `Request.locals` for
 * later use in setting response cache headers.
 * @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Caching#freshness
 * @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/If-None-Match
 * ```md
 * The If-None-Match HTTP request header makes the request conditional. For GET and HEAD methods, the server
 * will return the requested resource, with a 200 status, only if it doesn't have an ETag matching the given
 * ones. For other methods, the request will be processed only if the eventually existing resource's ETag
 * doesn't match any of the values listed.
 * ```
 */
export function getETagCacheHandler(
  db: PgStore,
  etagType: ETagType = ETagType.chainTip
): RequestHandler {
  const requestHandler = asyncHandler(async (req, res, next) => {
    const result = await checkETagCacheOK(db, req, etagType);
    if (result === CACHE_OK) {
      // Instruct the client to use the cached response via a `304 Not Modified` response header.
      // This completes the handling for this request, do not call `next()` in order to skip the
      // router handler used for non-cached responses.
      res.set('Cache-Control', CACHE_CONTROL_MUST_REVALIDATE).status(304).send();
    } else {
      // Request does not have a valid cache. Store the etag for later
      // use in setting response cache headers.
      const etag: ETag | undefined = result;
      res.locals[etagType] = etag;
      next();
    }
  });
  return requestHandler;
}

async function calculateETag(
  db: PgStore,
  etagType: ETagType,
  req: Request
): Promise<ETag | undefined> {
  switch (etagType) {
    case ETagType.chainTip:
      try {
        const chainTip = await db.getUnanchoredChainTip();
        if (!chainTip.found) {
          // This should never happen unless the API is serving requests before it has synced any
          // blocks.
          return;
        }
        return chainTip.result.microblockHash ?? chainTip.result.indexBlockHash;
      } catch (error) {
        logger.error(`Unable to calculate chain_tip ETag: ${error}`);
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
        logger.error(`Unable to calculate mempool ETag: ${error}`);
        return;
      }

    case ETagType.transaction:
      try {
        const { tx_id } = req.params;
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
        logger.error(`Unable to calculate transaction ETag: ${error}`);
        return;
      }
  }
}
