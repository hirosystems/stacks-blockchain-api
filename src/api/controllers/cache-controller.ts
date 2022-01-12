import { RequestHandler, Request, Response } from 'express';
import * as prom from 'prom-client';
import { FoundOrNot, logger } from '../../helpers';
import { DataStore, DbChainTip } from '../../datastore/common';
import { asyncHandler } from '../async-handler';

const CACHE_OK = Symbol('cache_ok');
const CHAIN_TIP_LOCAL = 'chain_tip';

// A `Cache-Control` header used for re-validation based caching.
// `public` == allow proxies/CDNs to cache as opposed to only local browsers.
// `no-cache` == clients can cache a resource but should revalidate each time before using it.
// `must-revalidate` == somewhat redundant directive to assert that cache must be revalidated, required by some CDNs
const CACHE_CONTROL_MUST_REVALIDATE = 'public, no-cache, must-revalidate';

interface ChainTipCacheMetrics {
  chainTipCacheHits: prom.Counter<string>;
  chainTipCacheMisses: prom.Counter<string>;
  chainTipCacheNoHeader: prom.Counter<string>;
}

let _chainTipMetrics: ChainTipCacheMetrics | undefined;
function getChainTipMetrics(): ChainTipCacheMetrics {
  if (_chainTipMetrics !== undefined) {
    return _chainTipMetrics;
  }
  const metrics: ChainTipCacheMetrics = {
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
  };
  _chainTipMetrics = metrics;
  return _chainTipMetrics;
}

export function setResponseNonCacheable(res: Response) {
  res.removeHeader('Cache-Control');
  res.removeHeader('ETag');
}

/**
 * Sets the response `Cache-Control` and `ETag` headers using the chain tip previously added
 * to the response locals.
 * Uses the latest unanchored microblock hash if available, otherwise uses the anchor
 * block index hash.
 */
export function setChainTipCacheHeaders(res: Response) {
  const chainTip: FoundOrNot<DbChainTip> | undefined = res.locals[CHAIN_TIP_LOCAL];
  if (!chainTip) {
    logger.error(
      `Cannot set cache control headers, no chain tip was set on \`Response.locals[CHAIN_TIP_LOCAL]\`.`
    );
    return;
  }
  if (!chainTip.found) {
    return;
  }
  const chainTipTag = chainTip.result.microblockHash ?? chainTip.result.indexBlockHash;
  res.set({
    'Cache-Control': CACHE_CONTROL_MUST_REVALIDATE,
    // Use the current chain tip `indexBlockHash` as the etag so that cache is invalidated on new blocks.
    // This value will be provided in the `If-None-Match` request header in subsequent requests.
    // See https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/ETag
    // > Entity tag that uniquely represents the requested resource.
    // > It is a string of ASCII characters placed between double quotes..
    ETag: `"${chainTipTag}"`,
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
 * Parse the `ETag` from the given request's `If-None-Match` header which represents the chain tip associated
 * with the client's cached response. Query the current chain tip from the db, and compare the two.
 * This function is also responsible for tracking the prometheus metrics associated with cache hits/misses.
 * @returns `CACHE_OK` if the client's cached response is up-to-date with the current chain tip, otherwise,
 * returns the current chain tip which can be used later for setting the cache control etag response header.
 */
async function checkChainTipCacheOK(
  db: DataStore,
  req: Request
): Promise<FoundOrNot<DbChainTip> | typeof CACHE_OK> {
  const metrics = getChainTipMetrics();
  const chainTip = await db.getUnanchoredChainTip();
  if (!chainTip.found) {
    // This should never happen unless the API is serving requests before it has synced any blocks.
    return chainTip;
  }
  // Parse ETag values from the request's `If-None-Match` header, if any.
  // Note: node.js normalizes `IncomingMessage.headers` to lowercase.
  const ifNoneMatch = parseIfNoneMatchHeader(req.headers['if-none-match']);
  if (ifNoneMatch === undefined || ifNoneMatch.length === 0) {
    // No if-none-match header specified.
    metrics.chainTipCacheNoHeader.inc();
    return chainTip;
  }
  const chainTipTag = chainTip.result.microblockHash ?? chainTip.result.indexBlockHash;
  if (ifNoneMatch.includes(chainTipTag)) {
    // The client cache's ETag matches the current chain tip, so no need to re-process the request
    // server-side as there will be no change in response. Record this as a "cache hit" and return CACHE_OK.
    metrics.chainTipCacheHits.inc();
    return CACHE_OK;
  } else {
    // The client cache's ETag is associated with an different block than current latest chain tip, typically
    // an older block or a forked block, so the client's cached response is stale and should not be used.
    // Record this as a "cache miss" and return the current chain tip.
    metrics.chainTipCacheMisses.inc();
    return chainTip;
  }
}

/**
 * Check if the request has an up-to-date cached response by comparing the `If-None-Match` request header to the
 * current chain tip. If the cache is valid then a `304 Not Modified` response is sent and the route handling for
 * this request is completed. If the cache is outdated, the current chain tip is added to the `Request.locals` for
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
export function getChainTipCacheHandler(db: DataStore): RequestHandler {
  const requestHandler = asyncHandler(async (req, res, next) => {
    const result = await checkChainTipCacheOK(db, req);
    if (result === CACHE_OK) {
      // Instruct the client to use the cached response via a `304 Not Modified` response header.
      // This completes the handling for this request, do not call `next()` in order to skip the
      // router handler used for non-cached responses.
      res.set('Cache-Control', CACHE_CONTROL_MUST_REVALIDATE).status(304).send();
    } else {
      // Request does not have a valid cache. Store the chainTip for later
      // use in setting response cache headers.
      const chainTip: FoundOrNot<DbChainTip> = result;
      res.locals[CHAIN_TIP_LOCAL] = chainTip;
      next();
    }
  });
  return requestHandler;
}
