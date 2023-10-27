import { BufferCV, bufferCV, cvToHex, hexToCV, TupleCV, tupleCV } from '@stacks/transactions';
import BigNumber from 'bignumber.js';
import * as btc from 'bitcoinjs-lib';
import * as dotenv from 'dotenv-flow';
import * as http from 'http';
import * as path from 'path';
import { isValidStacksAddress, stacksToBitcoinAddress } from 'stacks-encoding-native-js';
import * as stream from 'stream';
import * as ecc from 'tiny-secp256k1';
import * as util from 'util';
import { StacksCoreRpcClient } from './core-rpc/client';
import { DbEventTypeId } from './datastore/common';
import { logger } from './logger';
import { has0xPrefix, isDevEnv, numberToHex } from '@hirosystems/api-toolkit';

export const apiDocumentationUrl = process.env.API_DOCS_URL;

export const REPO_DIR = path.dirname(__dirname);

export const I32_MAX = 0x7fffffff;

export const EMPTY_HASH_256 = '0x0000000000000000000000000000000000000000000000000000000000000000';

export const pipelineAsync = util.promisify(stream.pipeline);

export function getIbdBlockHeight(): number | undefined {
  const val = process.env.IBD_MODE_UNTIL_BLOCK;
  if (val) {
    const num = Number.parseInt(val);
    return !Number.isNaN(num) ? num : undefined;
  }
}

function createEnumChecker<T extends string, TEnumValue extends number>(enumVariable: {
  [key in T]: TEnumValue;
}): (value: number) => value is TEnumValue {
  // Create a set of valid enum number values.
  const enumValues = Object.values<number>(enumVariable).filter(v => typeof v === 'number');
  const enumValueSet = new Set<number>(enumValues);
  return (value: number): value is TEnumValue => enumValueSet.has(value);
}

// eslint-disable-next-line @typescript-eslint/ban-types
const enumCheckFunctions = new Map<object, (value: number) => boolean>();

/**
 * Type guard to check if a given value is a valid enum value.
 * @param enumVariable - Literal `enum` type.
 * @param value - A value to check against the enum's values.
 * @example
 * ```ts
 * enum Color {
 *   Purple = 3,
 *   Orange = 5
 * }
 * const val: number = 3;
 * if (isEnum(Color, val)) {
 *   // `val` is known as enum type `Color`, e.g.:
 *   const colorVal: Color = val;
 * }
 * ```
 */
function isEnum<T extends string, TEnumValue extends number>(
  enumVariable: { [key in T]: TEnumValue },
  value: number
): value is TEnumValue {
  const checker = enumCheckFunctions.get(enumVariable);
  if (checker !== undefined) {
    return checker(value);
  }
  const newChecker = createEnumChecker(enumVariable);
  enumCheckFunctions.set(enumVariable, newChecker);
  return isEnum(enumVariable, value);
}

export function parseEnum<T extends string, TEnumValue extends number>(
  enumVariable: { [key in T]: TEnumValue },
  num: number,
  invalidEnumErrorFormatter?: (val: number) => Error
): TEnumValue {
  if (isEnum(enumVariable, num)) {
    return num;
  } else if (invalidEnumErrorFormatter !== undefined) {
    throw invalidEnumErrorFormatter(num);
  } else {
    throw new Error(`Failed to parse enum from value "${num}".`);
  }
}

// eslint-disable-next-line @typescript-eslint/ban-types
const enumMaps = new Map<object, Map<unknown, unknown>>();

export function getEnumDescription<T extends string, TEnumValue extends number>(
  enumVariable: { [key in T]: TEnumValue },
  value: number
): string {
  const enumMap = enumMaps.get(enumVariable);
  if (enumMap !== undefined) {
    const enumKey = enumMap.get(value);
    if (enumKey !== undefined) {
      return `${value} '${enumKey}'`;
    } else {
      return `${value}`;
    }
  }

  // Create a map of `[enumValue: number]: enumNameString`
  const enumValues = Object.entries(enumVariable)
    .filter(([, v]) => typeof v === 'number')
    .map<[number, string]>(([k, v]) => [v as number, k]);
  const newEnumMap = new Map(enumValues);
  enumMaps.set(enumVariable, newEnumMap);
  return getEnumDescription(enumVariable, value);
}

let didLoadDotEnv = false;

export function loadDotEnv(): void {
  if (didLoadDotEnv) {
    return;
  }
  const dotenvConfig = dotenv.config({ silent: true });
  if (dotenvConfig.error) {
    logger.error(dotenvConfig.error, 'Error loading .env file');
    throw dotenvConfig.error;
  }
  didLoadDotEnv = true;
}

export function formatMapToObject<TKey extends string, TValue, TFormatted>(
  map: Map<TKey, TValue>,
  formatter: (value: TValue) => TFormatted
): Record<TKey, TFormatted> {
  const obj = {} as Record<TKey, TFormatted>;
  for (const [key, value] of map) {
    obj[key] = formatter(value);
  }
  return obj;
}

// Note: this is the legacy amount defined in the Stacks 1.0 codebase:
// export const TOTAL_STACKS /* 1352464600000000 */ = new BigNumber(1320000000)
//   .plus(322146 * 100 + 5 * 50000) // air drop
//   .toString();

// See the Stacks 2.0 whitepaper: https://cloudflare-ipfs.com/ipfs/QmaGgiVHymeDjAc3aF1AwyhiFFwN97pme5m536cHT4FsAW
//   > The Stacks cryptocurrency has a predefined future supply that reaches approx 1,818M STX by year 2050
//   > Block reward: 1000 STX/block for first 4 yrs;
//   > 500 STX/block for following 4 yrs;
//   > 250 for the 4 yrs after that; and then 125 STX/block in perpetuity after that.
// We are going to use the year 2050 projected supply because "125 STX/block in perpetuity" means the total supply is infinite.
export const TOTAL_STACKS = new BigNumber(1_818_000_000n.toString());

const MICROSTACKS_IN_STACKS = 1_000_000n;
export const STACKS_DECIMAL_PLACES = 6;

export function stxToMicroStx(stx: bigint | number): bigint {
  const input = typeof stx === 'bigint' ? stx : BigInt(stx);
  return input * MICROSTACKS_IN_STACKS;
}

export function microStxToStx(microStx: bigint | BigNumber): string {
  const MAX_BIGNUMBER_ROUND_MODE = 8;
  const input = typeof microStx === 'bigint' ? new BigNumber(microStx.toString()) : microStx;
  const bigNumResult = new BigNumber(input).shiftedBy(-STACKS_DECIMAL_PLACES);
  return bigNumResult.toFixed(STACKS_DECIMAL_PLACES, MAX_BIGNUMBER_ROUND_MODE);
}

/**
 * Checks if a string is a valid Bitcoin address.
 * Supports mainnet and testnet address.
 * Supports bech32/p2wpkh/segwit/bip173, and b58/p2sh/"legacy" address formats.
 * @param address - A bitcoin address.
 */
export function isValidBitcoinAddress(address: string): boolean {
  btc.initEccLib(ecc);
  try {
    btc.address.toOutputScript(address, btc.networks.bitcoin);
    return true;
  } catch (e) {
    // ignore
  }
  try {
    btc.address.toOutputScript(address, btc.networks.testnet);
    return true;
  } catch (e) {
    // ignore
  }
  try {
    btc.address.toOutputScript(address, btc.networks.regtest);
    return true;
  } catch (e) {
    // ignore
  }
  return false;
}

export function tryConvertC32ToBtc(address: string): string | false {
  try {
    const result = stacksToBitcoinAddress(address);
    return result;
  } catch (e) {
    return false;
  }
}

export function isValidC32Address(stxAddress: string): boolean {
  try {
    return isValidStacksAddress(stxAddress);
  } catch (error) {
    return false;
  }
}

function isValidContractName(contractName: string): boolean {
  const CONTRACT_MIN_NAME_LENGTH = 1;
  const CONTRACT_MAX_NAME_LENGTH = 128;
  if (
    contractName.length > CONTRACT_MAX_NAME_LENGTH ||
    contractName.length < CONTRACT_MIN_NAME_LENGTH
  ) {
    return false;
  }
  const contractNameRegex = /^[a-zA-Z]([a-zA-Z0-9]|[-_])*$/;
  return contractNameRegex.test(contractName);
}

export function isValidPrincipal(
  principal: string
): false | { type: 'standardAddress' | 'contractAddress' } {
  if (!principal || typeof principal !== 'string') {
    return false;
  }
  if (principal.includes('.')) {
    const [addr, contractName] = principal.split('.');
    if (!isValidC32Address(addr)) {
      return false;
    }
    if (!isValidContractName(contractName)) {
      return false;
    }
    return { type: 'contractAddress' };
  } else {
    if (isValidC32Address(principal)) {
      return { type: 'standardAddress' };
    }
  }
  return false;
}

export type HttpClientResponse = http.IncomingMessage & {
  statusCode: number;
  statusMessage: string;
  response: string;
};

export function httpPostRequest(
  opts: http.RequestOptions & {
    /** Throw if the response was not successful (status outside the range 200-299). */
    throwOnNotOK?: boolean;
    body: Buffer;
  }
): Promise<HttpClientResponse> {
  return new Promise((resolve, reject) => {
    try {
      opts.method = 'POST';
      opts.headers = { 'Content-Length': opts.body.length, ...opts.headers };
      const req = http.request(opts, ((res: HttpClientResponse) => {
        const chunks: Buffer[] = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => {
          if (!res.complete) {
            return reject(
              new Error('The connection was terminated while the message was still being sent')
            );
          }
          const buffer = chunks.length === 1 ? chunks[0] : Buffer.concat(chunks);
          res.response = buffer.toString('utf8');
          if (opts.throwOnNotOK && (res.statusCode > 299 || res.statusCode < 200)) {
            const errorMsg = `Bad status response status code ${res.statusCode}: ${res.statusMessage}`;
            return reject(
              Object.assign(new Error(errorMsg), {
                requestUrl: `http://${opts.host}:${opts.port}${opts.path}`,
                statusCode: res.statusCode,
                response: res.response,
              })
            );
          }
          resolve(res);
        });
        res.on('error', error => reject(error));
      }) as (res: http.IncomingMessage) => void);
      req.on('error', error => reject(error));
      req.end(opts.body);
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * A helper function that uses the idiomatic Node.js convention for reading an http response body into memory.
 * Rejects if the http connection is terminated before the http response has been fully received.
 */
export function readHttpResponse(res: http.IncomingMessage): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    res.on('data', chunk => chunks.push(chunk));
    res.on('end', () => {
      if (!res.complete) {
        return reject(
          new Error('The connection was terminated while the message was still being sent')
        );
      }
      const buffer = chunks.length === 1 ? chunks[0] : Buffer.concat(chunks);
      resolve(buffer);
    });
    res.on('close', () => {
      if (!res.complete) {
        return reject(
          new Error('The connection was terminated while the message was still being sent')
        );
      }
    });
    res.on('error', error => {
      reject(error);
    });
  });
}

/**
 * Create an http request using Node.js standard `http` lib, providing more fine-grain control over
 * capabilities compared to wrappers like `node-fetch`.
 * @returns The http request and response once http headers are available (the typical behavior of Node.js http requests).
 */
export async function httpGetRequest(url: string, opts?: http.RequestOptions) {
  return new Promise<[http.ClientRequest, http.IncomingMessage]>((resolve, reject) => {
    try {
      const urlObj = new URL(url);
      const req = http.request(urlObj, opts ?? {}, res => {
        resolve([req, res]);
      });
      req.on('error', error => {
        reject(error);
      });
      req.end();
    } catch (error) {
      reject(error);
    }
  });
}

export function parsePort(portVal: number | string | undefined): number | undefined {
  if (portVal === undefined) {
    return undefined;
  }
  if (/^[-+]?(\d+|Infinity)$/.test(portVal.toString())) {
    const port = Number(portVal);
    if (port < 1 || port > 65535) {
      throw new Error(`Port ${port} is invalid`);
    }
    return port;
  } else {
    throw new Error(`Port ${portVal} is invalid`);
  }
}

/** Converts a unix timestamp (in seconds) to an ISO 8601 (YYYY-MM-DDTHH:mm:ss.sssZ) string */
export function unixEpochToIso(timestamp: number): string {
  try {
    const date = new Date(timestamp * 1000);
    const iso = date.toISOString();
    return iso;
  } catch (error) {
    throw error;
  }
}

export function unwrapOptional<T>(
  val: T | null,
  onNullish?: () => string
): Exclude<T, undefined | null> {
  if (val === undefined) {
    throw new Error(onNullish?.() ?? 'value is undefined');
  }
  if (val === null) {
    throw new Error(onNullish?.() ?? 'value is null');
  }
  return val as Exclude<T, undefined | null>;
}

/**
 * Provide an object and the key of a nullable / possibly-undefined property.
 * The function will throw if the property value is null or undefined, otherwise
 * the non-null / defined value is returned. Similar to {@link unwrapOptional}
 * but with automatic useful error messages indicating the property key name.
 * ```ts
 * const myObj: {
 *   thing1: string | null;
 *   thing2: string | undefined;
 *   thing3?: string;
 * } = {
 *   thing1: 'a',
 *   thing2: 'b',
 *   thing3: 'c',
 * };
 *
 * // Unwrap type `string | null` to `string`
 * const unwrapped1 = unwrapOptionalProp(myObj, 'thing1');
 * // Unwrap type `string | undefined` to `string`
 * const unwrapped2 = unwrapOptionalProp(myObj, 'thing2');
 * // Unwrap type `string?` to `string`
 * const unwrapped3 = unwrapOptionalProp(myObj, 'thing3');
 * ```
 */
export function unwrapOptionalProp<TObj, TKey extends keyof TObj>(
  obj: TObj,
  key: TKey
): Exclude<TObj[TKey], undefined | null> {
  const val = obj[key];
  if (val === undefined) {
    throw new Error(`Value for property ${String(key)} is undefined`);
  }
  if (val === null) {
    throw new Error(`Value for property ${String(key)} is null`);
  }
  return val as Exclude<TObj[TKey], undefined | null>;
}

export function assertNotNullish<T>(
  val: T,
  onNullish?: () => string
): val is Exclude<T, undefined> {
  if (val === undefined) {
    throw new Error(onNullish?.() ?? 'value is undefined');
  }
  if (val === null) {
    throw new Error(onNullish?.() ?? 'value is null');
  }
  return true;
}

/**
 * Iterate over an array, yielding multiple items at a time. If the size of the given array
 * is not divisible by the given batch size, then the length of the last items returned will
 * be smaller than the given batch size, i.e.:
 * ```typescript
 * items.length % batchSize
 * ```
 * @param items - The array to iterate over.
 * @param batchSize - Maximum number of items to return at a time.
 */
export function* batchIterate<T>(
  items: T[],
  batchSize: number,
  printBenchmark = isDevEnv
): Generator<T[]> {
  if (items.length === 0) {
    return;
  }
  const startTime = Date.now();
  for (let i = 0; i < items.length; ) {
    const itemsRemaining = items.length - i;
    const sliceSize = Math.min(batchSize, itemsRemaining);
    yield items.slice(i, i + sliceSize);
    i += sliceSize;
  }

  if (printBenchmark) {
    const itemsPerSecond = Math.round((items.length / (Date.now() - startTime)) * 1000);
    const caller = new Error().stack?.split('at ')[3].trim();
    logger.debug(`Iterated ${itemsPerSecond} items/second at ${caller}`);
  }
}

export async function* asyncBatchIterate<T>(
  items: AsyncIterable<T>,
  batchSize: number,
  printBenchmark = isDevEnv
): AsyncGenerator<T[], void, unknown> {
  const startTime = Date.now();
  let itemCount = 0;
  let itemBatch: T[] = [];
  for await (const item of items) {
    itemBatch.push(item);
    itemCount++;
    if (itemBatch.length >= batchSize) {
      yield itemBatch;
      itemBatch = [];
      if (printBenchmark) {
        const itemsPerSecond = Math.round((itemCount / (Date.now() - startTime)) * 1000);
        const caller = new Error().stack?.split('at ')[3].trim();
        logger.debug(`Iterated ${itemsPerSecond} items/second at ${caller}`);
      }
    }
  }
  if (itemBatch.length > 0) {
    yield itemBatch;
  }
}

export async function* asyncIterableToGenerator<T>(iter: AsyncIterable<T>) {
  for await (const entry of iter) {
    yield entry;
  }
}

function intMax(args: bigint[]): bigint;
function intMax(args: number[]): number;
function intMax(args: bigint[] | number[]): any {
  if (args.length === 0) {
    throw new Error(`empty array not supported in intMax`);
  } else if (typeof args[0] === 'bigint') {
    return (args as bigint[]).reduce((m, e) => (e > m ? e : m));
  } else if (typeof args[0] === 'number') {
    return Math.max(...(args as number[]));
  } else {
    // eslint-disable-next-line @typescript-eslint/ban-types
    throw new Error(`Unsupported type for intMax: ${(args[0] as object).constructor.name}`);
  }
}
export { intMax };

export class BigIntMath {
  static abs(a: bigint): bigint {
    return a < 0n ? -a : a;
  }
}

export function getOrAdd<K, V>(map: Map<K, V>, key: K, create: () => V): V {
  let val = map.get(key);
  if (val === undefined) {
    val = create();
    map.set(key, val);
  }
  return val;
}

export async function getOrAddAsync<K, V>(
  map: Map<K, V>,
  key: K,
  create: () => PromiseLike<V>
): Promise<V> {
  let val = map.get(key);
  if (val === undefined) {
    val = await create();
    map.set(key, val);
  }
  return val;
}

export type FoundOrNot<T> = { found: true; result: T } | { found: false; result?: T };

/**
 * Escape a string for use as a css selector name.
 * From https://github.com/mathiasbynens/CSS.escape/blob/master/css.escape.js
 */
export function cssEscape(value: string): string {
  const string = value;
  const length = string.length;
  let index = -1;
  let codeUnit: number;
  let result = '';
  const firstCodeUnit = string.charCodeAt(0);
  while (++index < length) {
    codeUnit = string.charCodeAt(index);
    // Note: there’s no need to special-case astral symbols, surrogate
    // pairs, or lone surrogates.

    // If the character is NULL (U+0000), then the REPLACEMENT CHARACTER
    // (U+FFFD).
    if (codeUnit == 0x0000) {
      result += '\uFFFD';
      continue;
    }

    if (
      // If the character is in the range [\1-\1F] (U+0001 to U+001F) or is
      // U+007F, […]
      (codeUnit >= 0x0001 && codeUnit <= 0x001f) ||
      codeUnit == 0x007f ||
      // If the character is the first character and is in the range [0-9]
      // (U+0030 to U+0039), […]
      (index == 0 && codeUnit >= 0x0030 && codeUnit <= 0x0039) ||
      // If the character is the second character and is in the range [0-9]
      // (U+0030 to U+0039) and the first character is a `-` (U+002D), […]
      (index == 1 && codeUnit >= 0x0030 && codeUnit <= 0x0039 && firstCodeUnit == 0x002d)
    ) {
      // https://drafts.csswg.org/cssom/#escape-a-character-as-code-point
      result += '\\' + codeUnit.toString(16) + ' ';
      continue;
    }

    if (
      // If the character is the first character and is a `-` (U+002D), and
      // there is no second character, […]
      index == 0 &&
      length == 1 &&
      codeUnit == 0x002d
    ) {
      result += '\\' + string.charAt(index);
      continue;
    }

    // If the character is not handled by one of the above rules and is
    // greater than or equal to U+0080, is `-` (U+002D) or `_` (U+005F), or
    // is in one of the ranges [0-9] (U+0030 to U+0039), [A-Z] (U+0041 to
    // U+005A), or [a-z] (U+0061 to U+007A), […]
    if (
      codeUnit >= 0x0080 ||
      codeUnit == 0x002d ||
      codeUnit == 0x005f ||
      (codeUnit >= 0x0030 && codeUnit <= 0x0039) ||
      (codeUnit >= 0x0041 && codeUnit <= 0x005a) ||
      (codeUnit >= 0x0061 && codeUnit <= 0x007a)
    ) {
      // the character itself
      result += string.charAt(index);
      continue;
    }

    // Otherwise, the escaped character.
    // https://drafts.csswg.org/cssom/#escape-a-character
    result += '\\' + string.charAt(index);
  }
  return result;
}

/**
 * Check if the input is a valid 32-byte hex string. If valid, returns a
 * lowercase and 0x-prefixed hex string. If invalid, returns false.
 */
export function normalizeHashString(input: string): string | false {
  if (typeof input !== 'string') {
    return false;
  }
  let hashBuffer: Buffer | undefined;
  if (input.length === 66 && has0xPrefix(input)) {
    hashBuffer = Buffer.from(input.slice(2), 'hex');
  } else if (input.length === 64) {
    hashBuffer = Buffer.from(input, 'hex');
  }
  if (hashBuffer === undefined || hashBuffer.length !== 32) {
    return false;
  }
  return `0x${hashBuffer.toString('hex')}`;
}

export function parseDataUrl(
  s: string
):
  | { mediaType?: string; contentType?: string; charset?: string; base64: boolean; data: string }
  | false {
  try {
    const url = new URL(s);
    if (url.protocol !== 'data:') {
      return false;
    }
    const validDataUrlRegex =
      /^data:([a-z]+\/[a-z0-9-+.]+(;[a-z0-9-.!#$%*+.{}|~`]+=[a-z0-9-.!#$%*+.{}()|~`]+)*)?(;base64)?,(.*)$/i;
    const parts = validDataUrlRegex.exec(s.trim());
    if (parts === null) {
      return false;
    }
    const parsed: {
      mediaType?: string;
      contentType?: string;
      charset?: string;
      base64: boolean;
      data: string;
    } = {
      base64: false,
      data: '',
    };
    if (parts[1]) {
      parsed.mediaType = parts[1].toLowerCase();
      const mediaTypeParts = parts[1].split(';').map(x => x.toLowerCase());
      parsed.contentType = mediaTypeParts[0];
      mediaTypeParts.slice(1).forEach(attribute => {
        const p = attribute.split('=');
        Object.assign(parsed, { [p[0]]: p[1] });
      });
    }
    parsed.base64 = !!parts[parts.length - 2];
    parsed.data = parts[parts.length - 1] || '';
    return parsed;
  } catch (e) {
    return false;
  }
}

/**
 * Unsigned 32-bit integer.
 *  - Mainnet: 0x00000001
 *  - Testnet: 0x80000000
 *  - Subnets: _dynamic_
 */
export type ChainID = number;

export const enum NETWORK_CHAIN_ID {
  mainnet = 0x00000001,
  testnet = 0x80000000,
}

/**
 * Checks if the given chain_id is a mainnet or testnet chain id.
 * First checks the L1 network IDs (mainnet=0x00000001 and testnet=0x80000000), then checks
 * the `CUSTOM_CHAIN_IDS` env var for any configured custom chain ids (used for subnets).
 */
export function getChainIDNetwork(chainID: ChainID): 'mainnet' | 'testnet' {
  if (chainID === NETWORK_CHAIN_ID.mainnet) {
    return 'mainnet';
  } else if (chainID === NETWORK_CHAIN_ID.testnet) {
    return 'testnet';
  }
  const chainIDHex = numberToHex(chainID);
  const customChainIDEnv = 'CUSTOM_CHAIN_IDS';
  const customChainIDs = process.env[customChainIDEnv];
  if (!customChainIDs) {
    throw new Error(
      `Unknown chain_id ${chainIDHex}, use ${customChainIDEnv} to specify custom testnet or mainnet chain_ids (for example for subnets)`
    );
  }

  const customIdMap = new Map<number, string>(
    customChainIDs
      .split(',')
      .map(pair => pair.split('='))
      .map(([k, v]) => [parseInt(v), k.trim().toLowerCase()])
  );
  const customIdNetwork = customIdMap.get(chainID);
  if (customIdNetwork) {
    if (customIdNetwork === 'testnet' || customIdNetwork === 'mainnet') {
      return customIdNetwork;
    }
    throw new Error(
      `Error parsing ${customChainIDEnv} chain_id network "${customIdNetwork}", should be either 'testnet' or 'mainnet'`
    );
  }
  throw new Error(
    `Unknown chain_id ${chainIDHex}, does not match mainnet=0x00000001, testnet=0x80000000, or any configured custom IDs: ${customChainIDEnv}=${customChainIDs}`
  );
}

export function chainIdConfigurationCheck() {
  const chainID = getApiConfiguredChainID();
  try {
    getChainIDNetwork(chainID);
  } catch (error) {
    logger.error(error);
    const chainIdHex = numberToHex(chainID);
    const mainnetHex = numberToHex(NETWORK_CHAIN_ID.mainnet);
    const testnetHex = numberToHex(NETWORK_CHAIN_ID.testnet);
    logger.error(
      `Oops! The configuration for STACKS_CHAIN_ID=${chainIdHex} does not match mainnet=${mainnetHex}, testnet=${testnetHex}, or custom chain IDs: CUSTOM_CHAIN_IDS=${process.env.CUSTOM_CHAIN_IDS}`
    );
  }
}

/**
 * Creates a Clarity tuple Buffer from a BNS name, just how it is stored in
 * received NFT events.
 */
export function bnsNameCV(name: string): string {
  const components = name.split('.');
  return cvToHex(
    tupleCV({
      name: bufferCV(Buffer.from(components[0])),
      namespace: bufferCV(Buffer.from(components[1])),
    })
  );
}

/**
 * Converts a hex Clarity value for a BNS name NFT into the string name
 * @param hex - hex encoded Clarity value of BNS name NFT
 * @returns BNS name string
 */
export function bnsHexValueToName(hex: string): string {
  const tuple = hexToCV(hex) as TupleCV;
  const name = tuple.data.name as BufferCV;
  const namespace = tuple.data.namespace as BufferCV;
  return `${Buffer.from(name.buffer).toString('utf8')}.${Buffer.from(namespace.buffer).toString(
    'utf8'
  )}`;
}

/**
 * Returns the parent BNS name from a subdomain.
 * @param subdomain - Fully qualified subdomain
 * @returns BNS name
 */
export function bnsNameFromSubdomain(subdomain: string): string {
  return subdomain.split('.').slice(-2).join('.');
}

export function getBnsSmartContractId(chainId: ChainID): string {
  return getChainIDNetwork(chainId) === 'mainnet'
    ? 'SP000000000000000000002Q6VF78.bns::names'
    : 'ST000000000000000000002AMW42H.bns::names';
}

export const enum SubnetContractIdentifer {
  mainnet = 'SP000000000000000000002Q6VF78.subnet',
  testnet = 'ST000000000000000000002AMW42H.subnet',
}

export function getSendManyContract(chainId: ChainID) {
  const contractId =
    getChainIDNetwork(chainId) === 'mainnet'
      ? process.env.MAINNET_SEND_MANY_CONTRACT_ID
      : process.env.TESTNET_SEND_MANY_CONTRACT_ID;
  return contractId;
}

/**
 * Gets the chain id as reported by the Stacks node.
 * @returns `ChainID` Chain id
 */
export async function getStacksNodeChainID(): Promise<ChainID> {
  const client = new StacksCoreRpcClient();
  await client.waitForConnection(Infinity);
  const coreInfo = await client.getInfo();
  // parse chain_id kind (mainnet or testnet) to ensure it is valid and understood by the API
  getChainIDNetwork(coreInfo.network_id);
  return coreInfo.network_id;
}

/**
 * Gets the chain id as configured by the `STACKS_CHAIN_ID` API env variable.
 * @returns `ChainID` Chain id
 */
export function getApiConfiguredChainID() {
  if (!('STACKS_CHAIN_ID' in process.env)) {
    const error = new Error(`Env var STACKS_CHAIN_ID is not set`);
    logger.error(error, error.message);
    throw error;
  }
  const configuredChainID: ChainID = parseInt(process.env['STACKS_CHAIN_ID'] as string);
  return configuredChainID;
}

export function parseEventTypeStrings(values: string[]): DbEventTypeId[] {
  return values.map(v => {
    switch (v) {
      case 'smart_contract_log':
        return DbEventTypeId.SmartContractLog;
      case 'stx_lock':
        return DbEventTypeId.StxLock;
      case 'stx_asset':
        return DbEventTypeId.StxAsset;
      case 'fungible_token_asset':
        return DbEventTypeId.FungibleTokenAsset;
      case 'non_fungible_token_asset':
        return DbEventTypeId.NonFungibleTokenAsset;
      default:
        throw new Error(`Unexpected event type: ${JSON.stringify(v)}`);
    }
  });
}

export function doesThrow(fn: () => void) {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
}

export enum BootContractAddress {
  mainnet = 'SP000000000000000000002Q6VF78',
  testnet = 'ST000000000000000000002AMW42H',
}
