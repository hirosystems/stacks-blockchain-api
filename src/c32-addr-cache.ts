/*
This module is hacky and does things that should generally be avoided in this codebase. We are using a procedure to
"re-export" a function on an existing module in order to add some functionality specific to the API. In this case,
the `c32check.c32address` function is difficult to override within this codebase. Many entry points into the function
are from calls into stacks.js libs. A cleaner solution would involve implementing optional params to many stacks.js
functions to provide a stx address encoding function. However, that would be a significant change to the stacks.js libs,
and for now this approach is much easier and faster.
*/

import * as c32check from 'c32check';
import * as LruCache from 'lru-cache';
import { stacksAddressFromParts } from '@hirosystems/stacks-encoding-native-js';

type c32AddressFn = typeof c32check.c32address;

const MAX_ADDR_CACHE_SIZE = 50_000;
export const ADDR_CACHE_ENV_VAR = 'STACKS_ADDRESS_CACHE_SIZE';

let addressLruCache: LruCache<string, string> | undefined;
export function getAddressLruCache() {
  if (addressLruCache === undefined) {
    let cacheSize = MAX_ADDR_CACHE_SIZE;
    const envAddrCacheVar = process.env[ADDR_CACHE_ENV_VAR];
    if (envAddrCacheVar) {
      cacheSize = Number.parseInt(envAddrCacheVar);
    }
    addressLruCache = new LruCache<string, string>({ max: cacheSize });
  }
  return addressLruCache;
}

const c32EncodeInjectedSymbol = Symbol();
let origC32AddressProp: PropertyDescriptor | undefined;
let origC32AddressFn: c32AddressFn | undefined;

function createC32AddressCache(origFn: c32AddressFn): c32AddressFn {
  const c32addressCached: c32AddressFn = (version, hash160hex) => {
    const cacheKey = `${version}${hash160hex}`;
    const addrCache = getAddressLruCache();
    let addrVal = addrCache.get(cacheKey);
    if (addrVal === undefined) {
      addrVal = stacksAddressFromParts(version, hash160hex);
      addrCache.set(cacheKey, addrVal);
    }
    return addrVal;
  };
  Object.defineProperty(c32addressCached, c32EncodeInjectedSymbol, { value: true });
  return c32addressCached;
}

/**
 * Override the `c32address` function on the `c32check` module to use an LRU cache
 * where commonly used encoded address strings can be cached.
 */
export function injectC32addressEncodeCache() {
  // Skip if already injected
  if (c32EncodeInjectedSymbol in c32check.c32address) {
    return;
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const c32checkModule = require('c32check');
  const origProp = Object.getOwnPropertyDescriptor(c32checkModule, 'c32address');
  if (!origProp) {
    throw new Error(`Could not get property descriptor for 'c32address' on module 'c32check'`);
  }
  origC32AddressProp = origProp;
  const origFn = origProp.get?.();
  if (!origFn) {
    throw new Error(`Falsy result for 'c32address' property getter on 'c32check' module`);
  }
  origC32AddressFn = origFn;
  const newFn = createC32AddressCache(origFn);

  // The exported module object specifies a property with a getter and setter (rather than simple indexer value),
  // so use `defineProperty` to work around errors from trying to set/re-define the property with `c32checkModule.c32address = newFn`.
  Object.defineProperty(c32checkModule, 'c32address', { get: () => newFn });
}

export function restoreC32AddressModule() {
  if (addressLruCache !== undefined) {
    addressLruCache.reset();
    addressLruCache = undefined;
  }

  if (origC32AddressProp !== undefined) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const c32checkModule = require('c32check');
    Object.defineProperty(c32checkModule, 'c32address', origC32AddressProp);
    origC32AddressProp = undefined;
  }
}
