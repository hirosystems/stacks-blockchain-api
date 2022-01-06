import { execSync } from 'child_process';
import * as crypto from 'crypto';
import * as dotenv from 'dotenv-flow';
import * as path from 'path';
import * as util from 'util';
import * as stream from 'stream';
import * as http from 'http';
import * as winston from 'winston';
import * as c32check from 'c32check';
import * as btc from 'bitcoinjs-lib';
import * as BN from 'bn.js';
import { ChainID } from '@stacks/transactions';
import BigNumber from 'bignumber.js';
import {
  CliConfigSetColors,
  NpmConfigSetLevels,
  SyslogConfigSetLevels,
} from 'winston/lib/winston/config';
import { DbStxEvent, DbTx } from './datastore/common';

export const isDevEnv = process.env.NODE_ENV === 'development';
export const isTestEnv = process.env.NODE_ENV === 'test';
export const isProdEnv =
  process.env.NODE_ENV === 'production' ||
  process.env.NODE_ENV === 'prod' ||
  !process.env.NODE_ENV ||
  (!isTestEnv && !isDevEnv);
export const apiDocumentationUrl = process.env.API_DOCS_URL;
export const isReadOnlyMode = parseArgBoolean(process.env['STACKS_READ_ONLY_MODE']);

export const APP_DIR = __dirname;
export const REPO_DIR = path.dirname(__dirname);

export const I32_MAX = 0x7fffffff;

export const EMPTY_HASH_256 = '0x0000000000000000000000000000000000000000000000000000000000000000';

export const pipelineAsync = util.promisify(stream.pipeline);

function createEnumChecker<T extends string, TEnumValue extends number>(
  enumVariable: { [key in T]: TEnumValue }
): (value: number) => value is TEnumValue {
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
  const dotenvConfig = dotenv.config();
  if (dotenvConfig.error) {
    logError(`Error loading .env file: ${dotenvConfig.error}`, dotenvConfig.error);
    throw dotenvConfig.error;
  }
  didLoadDotEnv = true;
}

type EqualsTest<T> = <A>() => A extends T ? 1 : 0;
type Equals<A1, A2> = EqualsTest<A2> extends EqualsTest<A1> ? 1 : 0;
type Filter<K, I> = Equals<K, I> extends 1 ? never : K;
type OmitIndex<T, I extends string | number> = {
  [K in keyof T as Filter<K, I>]: T[K];
};
type KnownKeys<T> = keyof OmitIndex<OmitIndex<T, number>, string>;

export type LogLevel = KnownKeys<NpmConfigSetLevels>;
type DisabledLogLevels = Exclude<
  KnownKeys<SyslogConfigSetLevels> | KnownKeys<CliConfigSetColors>,
  LogLevel
>;
type LoggerInterface = Omit<winston.Logger, DisabledLogLevels> & { level: LogLevel };

const LOG_LEVELS: LogLevel[] = ['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly'];
const defaultLogLevel: LogLevel = (() => {
  const STACKS_API_LOG_LEVEL_ENV_VAR = 'STACKS_API_LOG_LEVEL';
  const logLevelEnvVar = process.env[
    STACKS_API_LOG_LEVEL_ENV_VAR
  ]?.toLowerCase().trim() as LogLevel;
  if (logLevelEnvVar) {
    if (LOG_LEVELS.includes(logLevelEnvVar)) {
      return logLevelEnvVar;
    }
    throw new Error(
      `Invalid ${STACKS_API_LOG_LEVEL_ENV_VAR}, should be one of ${LOG_LEVELS.join(',')}`
    );
  }
  if (isDevEnv) {
    return 'debug';
  }
  return 'http';
})();

export const logger = winston.createLogger({
  level: defaultLogLevel,
  exitOnError: false,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json(),
    winston.format.errors({ stack: true })
  ),
  transports: [
    new winston.transports.Console({
      handleExceptions: true,
    }),
  ],
}) as LoggerInterface;

export function logError(message: string, ...errorData: any[]) {
  if (isDevEnv) {
    console.error(message);
    if (errorData?.length > 0) {
      errorData.forEach(e => console.error(e));
    }
  } else {
    if (errorData?.length > 0) {
      logger.error(message, ...errorData);
    } else {
      logger.error(message);
    }
  }
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

export const TOTAL_STACKS = new BigNumber(1320000000)
  .plus(322146 * 100 + 5 * 50000) // air drop
  .toString();

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

export function digestSha512_256(input: Buffer): Buffer {
  const hash = crypto.createHash('sha512-256');
  const digest = hash.update(input).digest();
  return digest;
}

/**
 * Checks if a string is a valid Bitcoin address.
 * Supports mainnet and testnet address.
 * Supports bech32/p2wpkh/segwit/bip173, and b58/p2sh/"legacy" address formats.
 * @param address - A bitcoin address.
 */
export function isValidBitcoinAddress(address: string): boolean {
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
  return false;
}

export function tryConvertC32ToBtc(address: string): string | false {
  try {
    const result = c32check.c32ToB58(address);
    return result;
  } catch (e) {
    return false;
  }
}

export function isValidC32Address(stxAddress: string): boolean {
  try {
    c32check.c32addressDecode(stxAddress);
    return true;
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

type HttpClientResponse = http.IncomingMessage & {
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

/**
 * Parses a boolean string using conventions from CLI arguments, URL query params, and environmental variables.
 * If the input is defined but empty string then true is returned. If the input is undefined or null than false is returned.
 * For example, if the input comes from a CLI arg like `--enable_thing` or URL query param like `?enable_thing`, then
 * this function expects to receive a defined but empty string, and returns true.
 * Otherwise, it checks or values like `true`, `1`, `on`, `yes` (and the inverses).
 * Throws if an unexpected input value is provided.
 */
export function parseArgBoolean(val: string | undefined | null): boolean {
  if (typeof val === 'undefined' || val === null) {
    return false;
  }
  switch (val.trim().toLowerCase()) {
    case '':
    case 'true':
    case '1':
    case 'on':
    case 'yes':
      return true;
    case 'false':
    case '0':
    case 'off':
    case 'no':
      return false;
    default:
      throw new Error(`Cannot parse boolean from "${val}"`);
  }
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

export function getCurrentGitTag(): string {
  const tagEnvVar = (process.env.GIT_TAG || '').trim();
  if (tagEnvVar) {
    return tagEnvVar;
  }

  if (!isDevEnv && !isTestEnv) {
    if (!tagEnvVar) {
      const error =
        'Production requires the GIT_TAG env var to be set. Set `NODE_ENV=development` to use the current git tag';
      console.error(error);
      throw new Error(error);
    }
    return tagEnvVar;
  }

  try {
    const gitTag = (execSync('git tag --points-at HEAD', { encoding: 'utf8' }) ?? '').trim();
    const gitCommit = (execSync('git rev-parse --short HEAD', { encoding: 'utf8' }) ?? '').trim();
    const result = gitTag || gitCommit;
    if (!result) {
      throw new Error('no git tag or commit hash available');
    }
    return result;
  } catch (error) {
    console.error(error);
    throw error;
  }
}

/**
 * Encodes a buffer as a `0x` prefixed lower-case hex string.
 * Returns an empty string if the buffer is zero length.
 */
export function bufferToHexPrefixString(buff: Buffer): string {
  if (buff.length === 0) {
    return '';
  }
  return '0x' + buff.toString('hex');
}

/**
 * Decodes a `0x` prefixed hex string to a buffer.
 * @param hex - A hex string with a `0x` prefix.
 */
export function hexToBuffer(hex: string): Buffer {
  if (hex.length === 0) {
    return Buffer.alloc(0);
  }
  if (!hex.startsWith('0x')) {
    throw new Error(`Hex string is missing the "0x" prefix: "${hex}"`);
  }
  if (hex.length % 2 !== 0) {
    throw new Error(`Hex string is an odd number of digits: ${hex}`);
  }
  return Buffer.from(hex.substring(2), 'hex');
}

export function numberToHex(number: number, paddingBytes: number = 4): string {
  let result = number.toString(16);
  if (result.length % 2 > 0) {
    result = '0' + result;
  }
  if (paddingBytes && result.length / 2 < paddingBytes) {
    result = '00'.repeat(paddingBytes - result.length / 2) + result;
  }
  return '0x' + result;
}

export function unwrapOptional<T>(val: T, onNullish?: () => string): Exclude<T, undefined> {
  if (val === undefined) {
    throw new Error(onNullish?.() ?? 'value is undefined');
  }
  if (val === null) {
    throw new Error(onNullish?.() ?? 'value is null');
  }
  return val as Exclude<T, undefined>;
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

export function distinctBy<T, V>(items: Iterable<T>, selector: (value: T) => V): T[] {
  const result: T[] = [];
  const set = new Set<V>();
  for (const item of items) {
    const key = selector(item);
    if (!set.has(key)) {
      set.add(key);
      result.push(item);
    }
  }
  return result;
}

function intMax(args: bigint[]): bigint;
function intMax(args: number[]): number;
function intMax(args: BN[]): BN;
function intMax(args: bigint[] | number[] | BN[]): any {
  if (args.length === 0) {
    throw new Error(`empty array not supported in intMax`);
  } else if (typeof args[0] === 'bigint') {
    return (args as bigint[]).reduce((m, e) => (e > m ? e : m));
  } else if (typeof args[0] === 'number') {
    return Math.max(...(args as number[]));
  } else if (BN.isBN(args[0])) {
    return (args as BN[]).reduce((m, e) => (e.gt(m) ? e : m));
  } else {
    // eslint-disable-next-line @typescript-eslint/ban-types
    throw new Error(`Unsupported type for intMax: ${(args[0] as object).constructor.name}`);
  }
}
export { intMax };

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ElementType<T extends any[]> = T extends (infer U)[] ? U : never;

export type FoundOrNot<T> = { found: true; result: T } | { found: false; result?: T };

export function timeout(ms: number, abortController?: AbortController): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      resolve();
    }, ms);
    abortController?.signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timeout);
        reject(new Error(`Timeout aborted`));
      },
      { once: true }
    );
  });
}

/**
 * Set an execution time limit for a promise.
 * @param promise - The promise being capped to `timeoutMs` max execution time
 * @param timeoutMs - Timeout limit in milliseconds
 * @param wait - If we should wait another `timeoutMs` period for `promise` to resolve
 * @param waitHandler - If `wait` is `true`, this closure will be executed before waiting another `timeoutMs` cycle
 * @returns `true` if `promise` ended gracefully, `false` if timeout was reached
 */
export async function resolveOrTimeout(
  promise: Promise<void>,
  timeoutMs: number,
  wait: boolean = false,
  waitHandler?: () => void
) {
  let timer: NodeJS.Timeout;
  const result = await Promise.race([
    new Promise(async (resolve, _) => {
      await promise;
      clearTimeout(timer);
      resolve(true);
    }),
    new Promise((resolve, _) => {
      timer = setInterval(() => {
        if (!wait) {
          clearTimeout(timer);
          resolve(false);
          return;
        }
        if (waitHandler) {
          waitHandler();
        }
      }, timeoutMs);
    }),
  ]);
  return result;
}

export type Waiter<T> = Promise<T> & {
  finish: (result: T) => void;
  isFinished: boolean;
};

export function waiter<T = void>(): Waiter<T> {
  let resolveFn: (result: T) => void;
  const promise = new Promise<T>(resolve => {
    resolveFn = resolve;
  });
  const completer = {
    finish: (result: T) => {
      completer.isFinished = true;
      resolveFn(result);
    },
    isFinished: false,
  };
  return Object.assign(promise, completer);
}

export function stopwatch(): {
  /** Milliseconds since stopwatch was created. */
  getElapsed: () => number;
  getElapsedAndRestart: () => number;
} {
  let start = process.hrtime();
  return {
    getElapsed: () => {
      const hrend = process.hrtime(start);
      return hrend[0] * 1000 + hrend[1] / 1000000;
    },
    getElapsedAndRestart: () => {
      const hrend = process.hrtime(start);
      const result = hrend[0] * 1000 + hrend[1] / 1000000;
      start = process.hrtime();
      return result;
    },
  };
}

export async function time<T>(
  fn: () => Promise<T>,
  onFinish: (elapsedMs: number) => void
): Promise<T> {
  const watch = stopwatch();
  try {
    return await fn();
  } finally {
    onFinish(watch.getElapsed());
  }
}

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

export const has0xPrefix = (id: string) => id.substr(0, 2).toLowerCase() === '0x';

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
    const validDataUrlRegex = /^data:([a-z]+\/[a-z0-9-+.]+(;[a-z0-9-.!#$%*+.{}|~`]+=[a-z0-9-.!#$%*+.{}()|~`]+)*)?(;base64)?,(.*)$/i;
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

export function getSendManyContract(chainId: ChainID) {
  const contractId =
    chainId === ChainID.Mainnet
      ? process.env.MAINNET_SEND_MANY_CONTRACT_ID
      : process.env.TESTNET_SEND_MANY_CONTRACT_ID;
  return contractId;
}

/**
 * Determines if a transaction involved a smart contract.
 * @param dbTx - Transaction DB entry
 * @param stxEvents - Associated STX Events for this tx
 * @returns true if tx involved a smart contract, false otherwise
 */
export function isSmartContractTx(dbTx: DbTx, stxEvents: DbStxEvent[] = []): boolean {
  if (
    dbTx.smart_contract_contract_id ||
    dbTx.contract_call_contract_id ||
    isValidContractName(dbTx.sender_address) ||
    (dbTx.token_transfer_recipient_address &&
      isValidContractName(dbTx.token_transfer_recipient_address))
  ) {
    return true;
  }
  for (const stxEvent of stxEvents) {
    if (
      (stxEvent.sender && isValidContractName(stxEvent.sender)) ||
      (stxEvent.recipient && isValidContractName(stxEvent.recipient))
    ) {
      return true;
    }
  }
  return false;
}
