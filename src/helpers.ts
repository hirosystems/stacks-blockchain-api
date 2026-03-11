import { BufferCV, bufferCV, cvToHex, hexToCV, TupleCV, tupleCV } from '@stacks/transactions';
import BigNumber from 'bignumber.js';
import * as btc from 'bitcoinjs-lib';
import * as http from 'http';
import * as path from 'path';
import { isValidStacksAddress, stacksToBitcoinAddress } from '@stacks/codec';
import * as ecc from 'tiny-secp256k1';
import { getCoreNodeEndpoint, StacksCoreRpcClient } from './core-rpc/client';
import { DbEventTypeId } from './datastore/common';
import { has0xPrefix, logger, numberToHex } from '@stacks/api-toolkit';
import { StacksNetwork, StacksTestnet } from '@stacks/network';
import { ENV } from './env';

export const REPO_DIR = path.dirname(__dirname);

export const I32_MAX = 0x7fffffff;

export const EMPTY_HASH_256 = '0x0000000000000000000000000000000000000000000000000000000000000000';

export function getStxFaucetNetwork(): StacksNetwork {
  const faucetNodeHostOverride: string | undefined = ENV.STACKS_FAUCET_NODE_HOST;
  if (faucetNodeHostOverride) {
    const faucetNodePortOverride: number | undefined = ENV.STACKS_FAUCET_NODE_PORT;
    if (!faucetNodePortOverride) {
      const error = 'STACKS_FAUCET_NODE_HOST is specified but STACKS_FAUCET_NODE_PORT is missing';
      logger.error(error);
      throw new Error(error);
    }
    const network = new StacksTestnet({
      url: `http://${faucetNodeHostOverride}:${faucetNodePortOverride}`,
    });
    return network;
  }
  return new StacksTestnet({
    url: `http://${getCoreNodeEndpoint()}`,
  });
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
// We are going to use the year 2050 projected supply because "125 STX/block in perpetuity" means
// the total supply is infinite.
// After SIP-031 was activated with Stacks 3.2, however, the total supply was increased by 500M STX
// to 2.318B STX.
export const TOTAL_STACKS_YEAR_2050 = new BigNumber(2_318_000_000n.toString());

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

export function unwrapNotNullish<T>(
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

export function assertNotNullish<T>(
  val: T | null | undefined,
  onNullish?: () => string
): asserts val is T {
  if (val === undefined || val === null) {
    throw new Error(onNullish?.() ?? 'value is nullish');
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

export type FoundOrNot<T> = { found: true; result: T } | { found: false; result?: T };

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

/**
 * Unsigned 32-bit integer.
 *  - Mainnet: 0x00000001
 *  - Testnet: 0x80000000
 *  - Subnets: _dynamic_
 */
export type ChainID = number;

const enum NETWORK_CHAIN_ID {
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
  const customChainIDs = ENV.CUSTOM_CHAIN_IDS;
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
      `Oops! The configuration for STACKS_CHAIN_ID=${chainIdHex} does not match mainnet=${mainnetHex}, testnet=${testnetHex}, or custom chain IDs: CUSTOM_CHAIN_IDS=${ENV.CUSTOM_CHAIN_IDS}`
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
      ? ENV.MAINNET_SEND_MANY_CONTRACT_ID
      : ENV.TESTNET_SEND_MANY_CONTRACT_ID;
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
export function getApiConfiguredChainID(): ChainID {
  return parseInt(ENV.STACKS_CHAIN_ID);
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

export enum BootContractAddress {
  mainnet = 'SP000000000000000000002Q6VF78',
  testnet = 'ST000000000000000000002AMW42H',
}

export class BitVec {
  bits: boolean[];
  constructor(bits: boolean[]) {
    this.bits = bits;
  }

  /**
   * Deserialize a bit vector from a bytes in the consensus format:
   *  - 2 bytes (u16): bit length (how many bits to read from the byte data)
   *  - 4 bytes (u32): data length (how many remaining bytes to read)
   */
  static consensusDeserialize(serializedData: Uint8Array) {
    const dataView = new DataView(serializedData.buffer, serializedData.byteOffset);
    const bitLen = dataView.getUint16(0);
    const dataLen = dataView.getUint32(2);
    const bitVecBytes = serializedData.subarray(6, 6 + dataLen);
    const bits = Array.from(
      { length: bitLen },
      (_, i) => !!(bitVecBytes[i >>> 3] & (128 >> i % 8))
    );
    return new BitVec(bits);
  }

  /** Return a base-2 string */
  toString() {
    return this.bits.map(b => (b ? '1' : '0')).join('');
  }

  /**
   * Deserialize a bit vector from a bytes in the consensus format, and return as a base-2 string
   */
  static consensusDeserializeToString(serializedData: Uint8Array | string): string {
    const data =
      typeof serializedData === 'string'
        ? Buffer.from(serializedData.replace(/^0x/, ''), 'hex')
        : serializedData;
    const bitVec = BitVec.consensusDeserialize(data);
    const bitVecStr = bitVec.toString();
    return bitVecStr;
  }
}

/**
 * Runs an array of promises sequentially, mapping each item to a promise and awaiting its result before moving to the next.
 */
export async function mapSeriesAsync<T, U>(
  items: T[],
  mapper: (item: T, index: number, array: T[]) => Promise<U>
): Promise<U[]> {
  const results: U[] = [];
  for (let i = 0; i < items.length; i++) {
    const result = await mapper(items[i], i, items);
    results.push(result);
  }
  return results;
}
