import { c32address } from 'c32check';
import * as LruCache from 'lru-cache';

type c32AddressFn = typeof c32address;

const MAX_ADDR_CACHE_SIZE = 50_000;

function createC32AddressCache(origFn: c32AddressFn): c32AddressFn {
  const addrCache = new LruCache<string, string>({ max: MAX_ADDR_CACHE_SIZE });
  const c32addressCached: c32AddressFn = (version, hash160hex) => {
    const cacheKey = `${version}${hash160hex}`;
    let addrVal = addrCache.get(cacheKey);
    if (addrVal === undefined) {
      addrVal = origFn(version, hash160hex);
      addrCache.set(cacheKey, addrVal);
    }
    return addrVal;
  };
  return c32addressCached;
}

/**
 * Override the `c32address` function on the `c32check` module to use an LRU cache
 * so commonly encoded address strings can be cached.
 */
export function injectC32addressEncodeCache() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const c32checkModule = require('c32check');
  const origFn: c32AddressFn = c32checkModule['c32address'];
  const newFn = createC32AddressCache(origFn);
  Object.defineProperty(c32checkModule, 'c32address', {
    get: () => newFn,
  });
}
