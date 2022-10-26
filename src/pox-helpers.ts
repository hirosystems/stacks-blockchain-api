import * as btc from 'bitcoinjs-lib';
import { bech32, bech32m } from '@scure/base';
import {
  decodeClarityValue,
  ClarityValueBuffer,
  ClarityValueStringAscii,
  ClarityValueTuple,
  ClarityValue,
  ClarityValueUInt,
  ClarityValuePrincipalStandard,
  ClarityValuePrincipalContract,
  ClarityTypeID,
  ClarityValueResponse,
} from 'stacks-encoding-native-js';
import { coerceToBuffer, logger } from './helpers';

// TODO: switch to using @stacks/stacking lib once available
//   currently borrowing its WIP code from:
//    https://github.com/hirosystems/stacks.js/pull/1354/files
//    https://github.com/hirosystems/stacks.js/blob/72b2db54a417d09028a66bcfb4f680d508e32c5c/packages/stacking/src/utils.ts

/** Address versions corresponding to pox.clar, pox-2.clar */
enum PoXAddressVersion {
  /** (b58/legacy) p2pkh address, and `hashbytes` is the 20-byte hash160 of a single public key */
  P2PKH = 0x00,

  /** (b58/legacy) p2sh address, and `hashbytes` is the 20-byte hash160 of a redeemScript script */
  P2SH = 0x01,

  /** (b58/legacy) p2wpkh-p2sh address, and `hashbytes` is the 20-byte hash160 of a p2wpkh witness script */
  P2SHP2WPKH = 0x02, // likely unused, as indistinguishable from P2SH

  /** (b58/legacy) p2wsh-p2sh address, and `hashbytes` is the 20-byte hash160 of a p2wsh witness script */
  P2SHP2WSH = 0x03, // likely unused, as indistinguishable from P2SH

  /** (bech32/segwit_v0) p2wpkh address, and `hashbytes` is the 20-byte hash160 of the witness script */
  P2WPKH = 0x04,

  /** (bech32/segwit_v0) p2wsh address, and `hashbytes` is the 32-byte sha256 of the witness script */
  P2WSH = 0x05,

  /** (bech32m/segwit_v1) p2tr address, and `hashbytes` is the 32-byte sha256 of the witness script */
  P2TR = 0x06,
}

const BitcoinNetworkVersion = {
  mainnet: {
    P2PKH: btc.networks.bitcoin.pubKeyHash, // 0x00 / 0
    P2SH: btc.networks.bitcoin.scriptHash, // 0x05 / 5
  },
  testnet: {
    P2PKH: btc.networks.testnet.pubKeyHash, // 0x6f / 111
    P2SH: btc.networks.testnet.scriptHash, // 0xc4 / 196
  },
  regtest: {
    P2PKH: btc.networks.regtest.pubKeyHash, // 0x6f / 111
    P2SH: btc.networks.regtest.scriptHash, // 0xc4 / 196
  },
} as const;

// Valid prefix chars for mainnet and testnet P2PKH and P2SH addresses
//  mainnet P2PKH: 1
//  testnet P2PKH: m or n
//  mainnet P2SH: 3
//  testnet P2SH: 2
//  regtest P2PKH: m or n
//  regtest P2SH: 2
const B58_ADDR_PREFIXES = /^(1|3|m|n|2)/;

// Valid prefixs for mainnet and testnet bech32/segwit addresses
const SEGWIT_ADDR_PREFIXES = /^(bc|tb)/i;
const SEGWIT_MAINNET_HRP = 'bc';
const SEGWIT_TESTNET_HRP = 'tb';
const SEGWIT_REGTEST_HRP = 'bcrt';

const SEGWIT_V0 = 0;
const SEGWIT_V1 = 1;

// Valid prefixes for supported segwit address, structure is:
//   HRP PREFIX + SEPARATOR (always '1') + C32_ENCODED SEGWIT_VERSION_BYTE ('q' for 0, 'p' for 1) + HASHDATA
const SEGWIT_V0_ADDR_PREFIX = /^(bc1q|tb1q|bcrt1q)/i;
const SEGWIT_V1_ADDR_PREFIX = /^(bc1p|tb1p|bcrt1p)/i;

// Segwit/taproot address examples:
//   mainnet P2WPKH: bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4
//   testnet P2WPKH: tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx
//   mainnet P2WSH: bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3
//   testnet P2WSH: tb1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3q0sl5k7
//   mainnet P2TR: bc1p5d7rjq7g6rdk2yhzks9smlaqtedr4dekq08ge8ztwac72sfr9rusxg3297
//   testnet P2TR: tb1p6h5fuzmnvpdthf5shf0qqjzwy7wsqc5rhmgq2ks9xrak4ry6mtrscsqvzp

function btcAddressVersionToLegacyHashMode(btcAddressVersion: number): PoXAddressVersion {
  switch (btcAddressVersion) {
    case BitcoinNetworkVersion.mainnet.P2PKH:
      return PoXAddressVersion.P2PKH;
    case BitcoinNetworkVersion.testnet.P2PKH:
      return PoXAddressVersion.P2PKH;
    case BitcoinNetworkVersion.regtest.P2PKH:
      return PoXAddressVersion.P2PKH;
    case BitcoinNetworkVersion.mainnet.P2SH:
      return PoXAddressVersion.P2SH;
    case BitcoinNetworkVersion.testnet.P2SH:
      return PoXAddressVersion.P2SH;
    case BitcoinNetworkVersion.regtest.P2SH:
      return PoXAddressVersion.P2SH;
    default:
      throw new Error(`Invalid pox address version byte ${btcAddressVersion}`);
  }
}

function legacyHashModeToBtcAddressVersion(
  hashMode: PoXAddressVersion,
  network: 'mainnet' | 'testnet' | 'regtest'
): number {
  if (hashMode === PoXAddressVersion.P2SHP2WPKH || hashMode === PoXAddressVersion.P2SHP2WSH) {
    // Use the same btc address version as P2SH
    hashMode = PoXAddressVersion.P2SH;
  }
  if (hashMode === PoXAddressVersion.P2PKH && network === 'mainnet') {
    return BitcoinNetworkVersion.mainnet.P2PKH;
  } else if (hashMode === PoXAddressVersion.P2PKH && network === 'testnet') {
    return BitcoinNetworkVersion.testnet.P2PKH;
  } else if (hashMode === PoXAddressVersion.P2PKH && network === 'regtest') {
    return BitcoinNetworkVersion.regtest.P2PKH;
  } else if (hashMode === PoXAddressVersion.P2SH && network === 'mainnet') {
    return BitcoinNetworkVersion.mainnet.P2SH;
  } else if (hashMode === PoXAddressVersion.P2SH && network === 'testnet') {
    return BitcoinNetworkVersion.testnet.P2SH;
  } else if (hashMode === PoXAddressVersion.P2SH && network === 'regtest') {
    return BitcoinNetworkVersion.regtest.P2SH;
  }
  throw new Error(`Invalid pox address hash mode byte: ${hashMode}`);
}

function bech32Decode(btcAddress: string) {
  const { words: bech32Words } = bech32.decode(btcAddress);
  const witnessVersion = bech32Words[0];

  if (witnessVersion > 0) {
    throw new Error(
      `Addresses with a witness version >= 1 should be encoded in bech32m, received version=${witnessVersion}`
    );
  }

  return {
    witnessVersion,
    data: Uint8Array.from(bech32.fromWords(bech32Words.slice(1))),
  };
}

function bech32MDecode(btcAddress: string) {
  const { words: bech32MWords } = bech32m.decode(btcAddress);
  const witnessVersion = bech32MWords[0];

  if (witnessVersion == 0) {
    throw new Error(
      `Addresses with witness version 1 should be encoded in bech32, received version=${witnessVersion}`
    );
  }

  return {
    witnessVersion,
    data: Uint8Array.from(bech32m.fromWords(bech32MWords.slice(1))),
  };
}

function nativeSegwitDecode(btcAddress: string): { witnessVersion: number; data: Uint8Array } {
  if (SEGWIT_V0_ADDR_PREFIX.test(btcAddress)) {
    return bech32Decode(btcAddress);
  } else if (SEGWIT_V1_ADDR_PREFIX.test(btcAddress)) {
    return bech32MDecode(btcAddress);
  }
  throw new Error(
    `Segwit address ${btcAddress} does not match valid prefix ${SEGWIT_V0_ADDR_PREFIX} or ${SEGWIT_V1_ADDR_PREFIX}`
  );
}

function nativeAddressToSegwitVersion(
  witnessVersion: number,
  dataLength: number
): PoXAddressVersion {
  if (witnessVersion === SEGWIT_V0 && dataLength === 20) {
    return PoXAddressVersion.P2WPKH;
  } else if (witnessVersion === SEGWIT_V0 && dataLength === 32) {
    return PoXAddressVersion.P2WSH;
  } else if (witnessVersion === SEGWIT_V1 && dataLength === 32) {
    return PoXAddressVersion.P2TR;
  } else {
    throw new Error(
      `Invalid native segwit witness version and byte length. Currently, only P2WPKH, P2WSH, and P2TR are supported. Received version=${witnessVersion}, length=${dataLength}`
    );
  }
}

export function decodeBtcAddress(btcAddress: string): { version: number; data: Buffer } {
  if (B58_ADDR_PREFIXES.test(btcAddress)) {
    try {
      const b58 = btc.address.fromBase58Check(btcAddress);
      const addressVersion = btcAddressVersionToLegacyHashMode(b58.version);
      return {
        version: addressVersion,
        data: b58.hash,
      };
    } catch (e) {
      throw new Error(`Bad bitcoin b58 address: ${btcAddress}, ${e}`);
    }
  } else if (SEGWIT_ADDR_PREFIXES.test(btcAddress)) {
    try {
      const b32 = nativeSegwitDecode(btcAddress);
      const addressVersion = nativeAddressToSegwitVersion(b32.witnessVersion, b32.data.length);
      return {
        version: addressVersion,
        data: Buffer.from(b32.data),
      };
    } catch (e) {
      throw new Error(`Bad bitcoin segwit address: ${btcAddress}, ${e}`);
    }
  }
  throw new Error(
    `Bad bitcoin address: ${btcAddress}, does not match b58 prefix ${B58_ADDR_PREFIXES} or segwit prefix ${SEGWIT_ADDR_PREFIXES}`
  );
}

function networkToHrp(network: 'mainnet' | 'testnet' | 'regtest'): string {
  switch (network) {
    case 'mainnet':
      return SEGWIT_MAINNET_HRP;
    case 'testnet':
      return SEGWIT_TESTNET_HRP;
    case 'regtest':
      return SEGWIT_REGTEST_HRP;
  }
  throw new Error(`Unexpected network: ${network}`);
}

export function poxAddressToBtcAddress(
  version: number | string | Uint8Array,
  hashBytes: string | Uint8Array,
  network: 'mainnet' | 'testnet' | 'regtest'
): string {
  let versionByte: number;
  if (typeof version === 'number') {
    versionByte = version;
  } else {
    const versionBuffer = coerceToBuffer(version);
    if (versionBuffer.byteLength !== 1) {
      throw new Error(`Expected single byte version, got ${version}`);
    }
    versionByte = versionBuffer[0];
  }
  let hashBytesBuffer: Buffer;
  if (typeof hashBytes === 'string') {
    hashBytesBuffer = coerceToBuffer(hashBytes);
  } else if (Buffer.isBuffer(hashBytes)) {
    hashBytesBuffer = hashBytes;
  } else {
    hashBytesBuffer = Buffer.from(hashBytes.buffer, hashBytes.byteOffset, hashBytes.byteLength);
  }
  switch (versionByte) {
    case PoXAddressVersion.P2PKH:
    case PoXAddressVersion.P2SH:
    case PoXAddressVersion.P2SHP2WPKH:
    case PoXAddressVersion.P2SHP2WSH: {
      const btcAddrVersion = legacyHashModeToBtcAddressVersion(versionByte, network);
      return btc.address.toBase58Check(hashBytesBuffer, btcAddrVersion);
    }
    case PoXAddressVersion.P2WPKH:
    case PoXAddressVersion.P2WSH: {
      const prefix = networkToHrp(network);
      const words = bech32.toWords(hashBytesBuffer);
      const btcAddress = bech32.encode(prefix, [SEGWIT_V0, ...words]);
      return btcAddress;
    }
    case PoXAddressVersion.P2TR: {
      const prefix = networkToHrp(network);
      const words = bech32m.toWords(hashBytesBuffer);
      const btcAddress = bech32m.encode(prefix, [SEGWIT_V1, ...words]);
      return btcAddress;
    }
  }
  throw new Error(`Unexpected address version: ${version}`);
}

function tryClarityPoxAddressToBtcAddress(
  poxAddr: PoX2Addr,
  network: 'mainnet' | 'testnet' | 'regtest'
): { btcAddr: string | null; raw: Buffer } {
  let btcAddr: string | null = null;
  try {
    btcAddr = poxAddressToBtcAddress(
      poxAddr.data.version.buffer,
      poxAddr.data.hashbytes.buffer,
      network
    );
  } catch (e) {
    logger.verbose(
      `Error encoding PoX address version: ${poxAddr.data.version.buffer}, hashbytes: ${poxAddr.data.hashbytes.buffer} to bitcoin address: ${e}`
    );
    btcAddr = null;
  }
  return {
    btcAddr,
    raw: Buffer.concat([
      coerceToBuffer(poxAddr.data.version.buffer),
      coerceToBuffer(poxAddr.data.hashbytes.buffer),
    ]),
  };
}

type PoX2Addr = ClarityValueTuple<{
  hashbytes: ClarityValueBuffer;
  version: ClarityValueBuffer;
}>;

type PoX2EventData = ClarityValueTuple<{
  name: ClarityValueStringAscii;
  balance: ClarityValueUInt;
  stacker: ClarityValuePrincipalStandard | ClarityValuePrincipalContract;
  locked: ClarityValueUInt;
  'burnchain-unlock-height': ClarityValueUInt;
  data: ClarityValueTuple;
}>;

interface PoX2PrintEventTypes {
  'handle-unlock': {
    'first-cycle-locked': ClarityValueUInt;
    'first-unlocked-cycle': ClarityValueUInt;
  };
  'stack-stx': {
    'lock-amount': ClarityValueUInt;
    'lock-period': ClarityValueUInt;
    'pox-addr': PoX2Addr;
    'start-burn-height': ClarityValueUInt;
    'unlock-burn-height': ClarityValueUInt;
  };
  'stack-increase': {
    'increase-by': ClarityValueUInt;
    'total-locked': ClarityValueUInt;
  };
  'stack-extend': {
    'increase-by': ClarityValueUInt;
    'total-locked': ClarityValueUInt;
    'pox-addr': PoX2Addr;
  };
  'delegate-stack-stx': {
    'lock-amount': ClarityValueUInt;
    'unlock-burn-height': ClarityValueUInt;
    'pox-addr': PoX2Addr;
    'start-burn-height': ClarityValueUInt;
    'lock-period': ClarityValueUInt;
    delegator: ClarityValuePrincipalStandard | ClarityValuePrincipalContract;
  };
  'delegate-stack-increase': {
    'pox-addr': PoX2Addr;
    'increase-by': ClarityValueUInt;
    'total-locked': ClarityValueUInt;
    delegator: ClarityValuePrincipalStandard | ClarityValuePrincipalContract;
  };
  'delegate-stack-extend': {
    'pox-addr': PoX2Addr;
    'unlock-burn-height': ClarityValueUInt;
    'extend-count': ClarityValueUInt;
    delegator: ClarityValuePrincipalStandard | ClarityValuePrincipalContract;
  };
  'stack-aggregation-commit': {
    'pox-addr': PoX2Addr;
    'reward-cycle': ClarityValueUInt;
    'amount-ustx': ClarityValueUInt;
  };
}

interface PoX2BaseEventData {
  stacker: string;
  locked: bigint;
  balance: bigint;
  burnchainUnlockHeight: bigint;
}

export interface PoX2HandleUnlockEvent extends PoX2BaseEventData {
  name: 'handle-unlock';
  data: {
    firstCycleLocked: bigint;
    firstUnlockedCycle: bigint;
  };
}

export interface PoX2StackStxEvent extends PoX2BaseEventData {
  name: 'stack-stx';
  data: {
    lockAmount: bigint;
    lockPeriod: bigint;
    startBurnHeight: bigint;
    unlockBurnHeight: bigint;
    poxAddr: string | null;
    poxAddrRaw: Buffer | null;
  };
}

export interface PoX2StackIncreaseEvent extends PoX2BaseEventData {
  name: 'stack-increase';
  data: {
    increaseBy: bigint;
    totalLocked: bigint;
  };
}

export interface PoX2StackExtendEvent extends PoX2BaseEventData {
  name: 'stack-extend';
  data: {
    increaseBy: bigint;
    totalLocked: bigint;
    poxAddr: string | null;
    poxAddrRaw: Buffer | null;
  };
}

export interface PoX2DelegateStackStxEvent extends PoX2BaseEventData {
  name: 'delegate-stack-stx';
  data: {
    lockAmount: bigint;
    unlockBurnHeight: bigint;
    startBurnHeight: bigint;
    lockPeriod: bigint;
    poxAddr: string | null;
    poxAddrRaw: Buffer | null;
    delegator: string;
  };
}

export interface PoX2DelegateStackIncreaseEvent extends PoX2BaseEventData {
  name: 'delegate-stack-increase';
  data: {
    increaseBy: bigint;
    totalLocked: bigint;
    poxAddr: string | null;
    poxAddrRaw: Buffer | null;
    delegator: string;
  };
}

export interface PoX2DelegateStackExtendEvent extends PoX2BaseEventData {
  name: 'delegate-stack-extend';
  data: {
    increaseBy: bigint;
    totalLocked: bigint;
    poxAddr: string | null;
    poxAddrRaw: Buffer | null;
    delegator: string;
  };
}

export interface PoX2StackAggregationCommitEvent extends PoX2BaseEventData {
  name: 'stack-aggregation-commit';
  data: {
    increaseBy: bigint;
    totalLocked: bigint;
    poxAddr: string | null;
    poxAddrRaw: Buffer | null;
  };
}

export type PoX2Event =
  | PoX2HandleUnlockEvent
  | PoX2StackStxEvent
  | PoX2StackIncreaseEvent
  | PoX2StackExtendEvent
  | PoX2DelegateStackStxEvent
  | PoX2DelegateStackIncreaseEvent
  | PoX2DelegateStackExtendEvent
  | PoX2StackAggregationCommitEvent;

function clarityPrincipalToFullAddress(
  principal: ClarityValuePrincipalStandard | ClarityValuePrincipalContract
): string {
  if (principal.type_id === ClarityTypeID.PrincipalStandard) {
    return principal.address;
  } else if (principal.type_id === ClarityTypeID.PrincipalContract) {
    return `${principal.address}.${principal.contract_name}`;
  }
  throw new Error(
    `Unexpected Clarity value type for principal: ${(principal as ClarityValue).type_id}`
  );
}

export function decodePoX2Event(
  rawClarityData: string,
  network: 'mainnet' | 'testnet' | 'regtest'
): PoX2Event {
  const decoded = decodeClarityValue<ClarityValueResponse>(rawClarityData);
  if (decoded.type_id !== ClarityTypeID.ResponseOk) {
    throw new Error(
      `Unexpected PoX2 event Clarity type ID, expected ResponseOk, got ${decoded.type_id}`
    );
  }
  if (decoded.value.type_id !== ClarityTypeID.Tuple) {
    throw new Error(
      `Unexpected PoX2 event Clarity type ID, expected Tuple, got ${decoded.value.type_id}`
    );
  }
  const opData = (decoded.value as PoX2EventData).data;

  const baseEventData: PoX2BaseEventData = {
    stacker: clarityPrincipalToFullAddress(opData.stacker),
    locked: BigInt(opData.locked.value),
    balance: BigInt(opData.balance.value),
    burnchainUnlockHeight: BigInt(opData['burnchain-unlock-height'].value),
  };

  const eventName = opData.name.data as keyof PoX2PrintEventTypes;
  if (opData.name.type_id !== ClarityTypeID.StringAscii) {
    throw new Error(
      `Unexpected PoX2 event name type, expected StringAscii, got ${opData.name.type_id}`
    );
  }

  const eventData = opData.data.data;
  if (opData.data.type_id !== ClarityTypeID.Tuple) {
    throw new Error(
      `Unexpected PoX2 event data payload type, expected Tuple, got ${opData.data.type_id}`
    );
  }

  let poxAddr: string | null = null;
  let poxAddrRaw: Buffer | null = null;
  if ('pox-addr' in eventData) {
    const eventPoxAddr = eventData['pox-addr'] as PoX2Addr;
    const encodedArr = tryClarityPoxAddressToBtcAddress(eventPoxAddr, network);
    poxAddr = encodedArr.btcAddr;
    poxAddrRaw = encodedArr.raw;
  }

  switch (eventName) {
    case 'handle-unlock': {
      const d = eventData as PoX2PrintEventTypes[typeof eventName];
      const parsedData: PoX2HandleUnlockEvent = {
        ...baseEventData,
        name: eventName,
        data: {
          firstCycleLocked: BigInt(d['first-cycle-locked'].value),
          firstUnlockedCycle: BigInt(d['first-unlocked-cycle'].value),
        },
      };
      return parsedData;
    }
    case 'stack-stx': {
      const d = eventData as PoX2PrintEventTypes[typeof eventName];
      const parsedData: PoX2StackStxEvent = {
        ...baseEventData,
        name: eventName,
        data: {
          lockAmount: BigInt(d['lock-amount'].value),
          lockPeriod: BigInt(d['lock-period'].value),
          startBurnHeight: BigInt(d['start-burn-height'].value),
          unlockBurnHeight: BigInt(d['unlock-burn-height'].value),
          poxAddr: poxAddr,
          poxAddrRaw: poxAddrRaw,
        },
      };
      return parsedData;
    }
    case 'stack-increase': {
      const d = eventData as PoX2PrintEventTypes[typeof eventName];
      const parsedData: PoX2StackIncreaseEvent = {
        ...baseEventData,
        name: eventName,
        data: {
          increaseBy: BigInt(d['increase-by'].value),
          totalLocked: BigInt(d['total-locked'].value),
        },
      };
      return parsedData;
    }
    case 'stack-extend': {
      const d = eventData as PoX2PrintEventTypes[typeof eventName];
      const parsedData: PoX2StackExtendEvent = {
        ...baseEventData,
        name: eventName,
        data: {
          increaseBy: BigInt(d['increase-by'].value),
          totalLocked: BigInt(d['total-locked'].value),
          poxAddr: poxAddr,
          poxAddrRaw: poxAddrRaw,
        },
      };
      return parsedData;
    }
    case 'delegate-stack-stx': {
      const d = eventData as PoX2PrintEventTypes[typeof eventName];
      const parsedData: PoX2DelegateStackStxEvent = {
        ...baseEventData,
        name: eventName,
        data: {
          lockAmount: BigInt(d['lock-amount'].value),
          unlockBurnHeight: BigInt(d['unlock-burn-height'].value),
          startBurnHeight: BigInt(d['start-burn-height'].value),
          lockPeriod: BigInt(d['lock-period'].value),
          poxAddr: poxAddr,
          poxAddrRaw: poxAddrRaw,
          delegator: clarityPrincipalToFullAddress(d['delegator']),
        },
      };
      return parsedData;
    }
    case 'delegate-stack-increase': {
      const d = eventData as PoX2PrintEventTypes[typeof eventName];
      const parsedData: PoX2DelegateStackIncreaseEvent = {
        ...baseEventData,
        name: eventName,
        data: {
          increaseBy: BigInt(d['increase-by'].value),
          totalLocked: BigInt(d['total-locked'].value),
          poxAddr: poxAddr,
          poxAddrRaw: poxAddrRaw,
          delegator: clarityPrincipalToFullAddress(d['delegator']),
        },
      };
      return parsedData;
    }
    case 'delegate-stack-extend': {
      const d = eventData as PoX2PrintEventTypes[typeof eventName];
      const parsedData: PoX2DelegateStackExtendEvent = {
        ...baseEventData,
        name: eventName,
        data: {
          increaseBy: BigInt(d['unlock-burn-height'].value),
          totalLocked: BigInt(d['extend-count'].value),
          poxAddr: poxAddr,
          poxAddrRaw: poxAddrRaw,
          delegator: clarityPrincipalToFullAddress(d['delegator']),
        },
      };
      return parsedData;
    }
    case 'stack-aggregation-commit': {
      const d = eventData as PoX2PrintEventTypes[typeof eventName];
      const parsedData: PoX2StackAggregationCommitEvent = {
        ...baseEventData,
        name: eventName,
        data: {
          increaseBy: BigInt(d['reward-cycle'].value),
          totalLocked: BigInt(d['amount-ustx'].value),
          poxAddr: poxAddr,
          poxAddrRaw: poxAddrRaw,
        },
      };
      return parsedData;
    }
    default:
      throw new Error(`Unexpected PoX-2 event data name: ${opData.name.data}`);
  }
}

export const enum PoX2ContractIdentifer {
  mainnet = 'SP000000000000000000002Q6VF78.pox-2',
  testnet = 'ST000000000000000000002AMW42H.pox-2',
}
