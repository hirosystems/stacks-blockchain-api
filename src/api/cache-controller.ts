import { RequestHandler, Request, Response } from 'express';
import { logger } from '../helpers';
import { DataStore } from '../datastore/common';
import { isUnanchoredRequest } from './query-helpers';

async function handlerAsync(
  db: DataStore,
  req: Request,
  res: Response
): Promise<{
  cacheOk: boolean;
}> {
  const currentEtag = await getCurrentChainTipEtag(db, req, res);
  if (!currentEtag) {
    return { cacheOk: false };
  }

  // See https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/If-None-Match
  // > The If-None-Match HTTP request header makes the request conditional. For GET and HEAD methods, the server
  // > will return the requested resource, with a 200 status, only if it doesn't have an ETag matching the given
  // > ones. For other methods, the request will be processed only if the eventually existing resource's ETag
  // > doesn't match any of the values listed.
  const ifNoneMatch = parseIfNoneMatchHeader(req.headers['if-none-match']);

  // Check if the requesting client already has a cached response at the current chain tip.
  if (ifNoneMatch.includes(currentEtag)) {
    // The client cache's ETag matches the current chain tip, so no need to re-process the request server-side as there
    // will be no change in response. Instruct the client to use the cached response via a `304 Not Modified` header.
    // See https://developer.mozilla.org/en-US/docs/Web/HTTP/Caching#freshness
    res.status(304).send();
    return { cacheOk: true };
  } else {
    res.set({
      // This is the equivalent of `public, max-age=0, must-revalidate`.
      // `public` == allow proxies/CDNs to cache as opposed to only local browsers.
      // `no-cache` == clients can cache a resource but should revalidate each time before using it.
      'Cache-Control': 'public, no-cache',
      // Use the current chain tip `indexBlockHash` as the etag so that cache is invalidated on new blocks.
      // This value will be provided in the `If-None-Match` request header in subsequent requests.
      // See https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/ETag
      // > Entity tag that uniquely represents the requested resource.
      // > It is a string of ASCII characters placed between double quotes..
      ETag: `"${currentEtag}"`,
    });
    return { cacheOk: false };
  }
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
 * If-None-Match: "etag_value", "etag_value", …
 * If-None-Match: *
 * ```
 * @param ifNoneMatchHeaderValue - raw header value
 * @returns an array of etag values
 */
function parseIfNoneMatchHeader(ifNoneMatchHeaderValue: string | undefined): string[] {
  if (!ifNoneMatchHeaderValue) {
    return [];
  }
  // Strip wrapping double quotes like `"hello"` and the ETag validation-prefix like `W/"hello"`.
  // The API returns compliant, strong-validation ETags (double quoted ASCII), but can't control what
  // clients, proxies, CDNs, etc may provide.
  const normalized = /^(?:"|W\/")?(.*?)"?$/gi.exec(ifNoneMatchHeaderValue.trim())?.[1];
  if (!normalized) {
    // This should never happen unless handling a buggy request with something like `If-None-Match: ""`,
    // or if there's a flaw in the above code. Log warning for now.
    logger.warn(`Normalized If-None-Match header is falsy: ${ifNoneMatchHeaderValue}`);
    return [];
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
 * Get the current up-to-date chain tip which is represented as the etag.
 * For `unanchored` requests get the latest microblock hash, otherwise use the latest anchor block index hash.
 * @returns string if usable chain tip value is available, otherwise `false`;
 */
async function getCurrentChainTipEtag(
  db: DataStore,
  req: Request,
  res: Response
): Promise<string | false> {
  if (isUnanchoredRequest(req, res)) {
    const unanchoredChainTip = await db.getUnanchoredBlockTip();
    if (!unanchoredChainTip.found) {
      // No blocks in the db. Could happen if pointed to an unpopulated db i.e. when the node is syncing.
      // Shouldn't really happen in typical deployments, so log a warning in case something else is wrong.
      logger.warn(`No current unanchored chain tip found to compare If-None-Match header.`);
      return false;
    }
    return unanchoredChainTip.result.hash;
  } else {
    const chainTip = await db.getCurrentBlock();
    if (!chainTip.found) {
      // No blocks in the db. Could happen if pointed to an unpopulated db i.e. when the node is syncing.
      // Shouldn't really happen in typical deployments, so log a warning in case something else is wrong.
      logger.warn(`No current chain tip found to compare If-None-Match header.`);
      return false;
    }
    return chainTip.result.index_block_hash;
  }
}

export function createChainTipCacheMiddleware(db: DataStore) {
  const handleWrapped: RequestHandler = (req, res, next) => {
    if (req.method !== 'GET') {
      return next();
    }
    try {
      handlerAsync(db, req, res)
        .then(({ cacheOk }) => {
          if (!cacheOk) {
            next();
          } else {
            // TODO: add prom metrics for cache-hits
          }
        })
        .catch(error => next(error));
    } catch (error) {
      next(error);
    }
  };

  return handleWrapped;
}
