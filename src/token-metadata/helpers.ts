import { ClarityAbi, ClarityAbiFunction } from '@stacks/transactions';
import {
  METADATA_MAX_PAYLOAD_BYTE_SIZE,
  TokenMetadataErrorMode,
  TokenMetadataProcessingMode,
} from './tokens-contract-handler';
import fetch from 'node-fetch';
import { parseArgBoolean } from '../helpers';

export function isFtMetadataEnabled() {
  const opt = process.env['STACKS_API_ENABLE_FT_METADATA']?.toLowerCase().trim();
  return opt === '1' || opt === 'true';
}

export function isNftMetadataEnabled() {
  const opt = process.env['STACKS_API_ENABLE_NFT_METADATA']?.toLowerCase().trim();
  return opt === '1' || opt === 'true';
}

/**
 * Determines the token metadata processing mode based on .env values.
 * @returns TokenMetadataProcessingMode
 */
export function getTokenMetadataProcessingMode(): TokenMetadataProcessingMode {
  if (parseArgBoolean(process.env['STACKS_API_TOKEN_METADATA_STRICT_MODE'])) {
    return TokenMetadataProcessingMode.strict;
  }
  return TokenMetadataProcessingMode.default;
}

export function getTokenMetadataMaxRetries() {
  const opt = process.env['STACKS_API_TOKEN_METADATA_MAX_RETRIES'] ?? '5';
  return parseInt(opt);
}

export function getTokenMetadataFetchTimeoutMs() {
  const opt = process.env['STACKS_API_TOKEN_METADATA_FETCH_TIMEOUT_MS'] ?? '10000';
  return parseInt(opt);
}

/**
 * Determines the token metadata error handling mode based on .env values.
 * @returns TokenMetadataMode
 */
export function tokenMetadataErrorMode(): TokenMetadataErrorMode {
  switch (process.env['STACKS_API_TOKEN_METADATA_ERROR_MODE']) {
    case 'error':
      return TokenMetadataErrorMode.error;
    default:
      return TokenMetadataErrorMode.warning;
  }
}

const FT_FUNCTIONS: ClarityAbiFunction[] = [
  {
    access: 'public',
    args: [
      { type: 'uint128', name: 'amount' },
      { type: 'principal', name: 'sender' },
      { type: 'principal', name: 'recipient' },
      { type: { optional: { buffer: { length: 34 } } }, name: 'memo' },
    ],
    name: 'transfer',
    outputs: { type: { response: { ok: 'bool', error: 'uint128' } } },
  },
  {
    access: 'read_only',
    args: [],
    name: 'get-name',
    outputs: { type: { response: { ok: { 'string-ascii': { length: 32 } }, error: 'uint128' } } },
  },
  {
    access: 'read_only',
    args: [],
    name: 'get-symbol',
    outputs: { type: { response: { ok: { 'string-ascii': { length: 32 } }, error: 'uint128' } } },
  },
  {
    access: 'read_only',
    args: [],
    name: 'get-decimals',
    outputs: { type: { response: { ok: 'uint128', error: 'uint128' } } },
  },
  {
    access: 'read_only',
    args: [{ type: 'principal', name: 'address' }],
    name: 'get-balance',
    outputs: { type: { response: { ok: 'uint128', error: 'uint128' } } },
  },
  {
    access: 'read_only',
    args: [],
    name: 'get-total-supply',
    outputs: { type: { response: { ok: 'uint128', error: 'uint128' } } },
  },
  {
    access: 'read_only',
    args: [],
    name: 'get-token-uri',
    outputs: {
      type: {
        response: {
          ok: {
            optional: { 'string-ascii': { length: 256 } },
          },
          error: 'uint128',
        },
      },
    },
  },
];

const NFT_FUNCTIONS: ClarityAbiFunction[] = [
  {
    access: 'read_only',
    args: [],
    name: 'get-last-token-id',
    outputs: {
      type: {
        response: {
          ok: 'uint128',
          error: 'uint128',
        },
      },
    },
  },
  {
    access: 'read_only',
    args: [{ name: 'any', type: 'uint128' }],
    name: 'get-token-uri',
    outputs: {
      type: {
        response: {
          ok: {
            optional: { 'string-ascii': { length: 256 } },
          },
          error: 'uint128',
        },
      },
    },
  },
  {
    access: 'read_only',
    args: [{ type: 'uint128', name: 'any' }],
    name: 'get-owner',
    outputs: {
      type: {
        response: {
          ok: {
            optional: 'principal',
          },
          error: 'uint128',
        },
      },
    },
  },
  {
    access: 'public',
    args: [
      { type: 'uint128', name: 'id' },
      { type: 'principal', name: 'sender' },
      { type: 'principal', name: 'recipient' },
    ],
    name: 'transfer',
    outputs: {
      type: {
        response: {
          ok: 'bool',
          error: {
            tuple: [
              { type: { 'string-ascii': { length: 32 } }, name: 'kind' },
              { type: 'uint128', name: 'code' },
            ],
          },
        },
      },
    },
  },
];

/**
 * Checks if the given ABI contains functions from FT or NFT metadata standards (e.g. sip-09, sip-10) which can be resolved.
 * The function also checks if the server has FT and/or NFT metadata processing enabled.
 */
export function isProcessableTokenMetadata(abi: ClarityAbi): boolean {
  return (
    (isFtMetadataEnabled() && isCompliantFt(abi)) || (isNftMetadataEnabled() && isCompliantNft(abi))
  );
}

export function isCompliantNft(abi: ClarityAbi): boolean {
  if (abi.non_fungible_tokens.length > 0) {
    if (abiContains(abi, NFT_FUNCTIONS)) {
      return true;
    }
  }
  return false;
}

export function isCompliantFt(abi: ClarityAbi): boolean {
  if (abi.fungible_tokens.length > 0) {
    if (abiContains(abi, FT_FUNCTIONS)) {
      return true;
    }
  }
  return false;
}

/**
 * This method check if the contract is compliance with sip-09 and sip-10
 * Ref: https://github.com/stacksgov/sips/tree/main/sips
 */
function abiContains(abi: ClarityAbi, standardFunction: ClarityAbiFunction[]): boolean {
  return standardFunction.every(abiFun => findFunction(abiFun, abi.functions));
}

/**
 * check if the fun  exist in the function list
 * @param fun - function to be found
 * @param functionList - list of functions
 * @returns - true if function is in the list false otherwise
 */
function findFunction(fun: ClarityAbiFunction, functionList: ClarityAbiFunction[]): boolean {
  const found = functionList.find(standardFunction => {
    if (standardFunction.name !== fun.name || standardFunction.args.length !== fun.args.length)
      return false;
    for (let i = 0; i < fun.args.length; i++) {
      if (standardFunction.args[i].type.toString() !== fun.args[i].type.toString()) {
        return false;
      }
    }
    return true;
  });
  return found !== undefined;
}

export async function performFetch<Type>(
  url: string,
  opts?: {
    timeoutMs?: number;
    maxResponseBytes?: number;
  }
): Promise<Type> {
  const result = await fetch(url, {
    size: opts?.maxResponseBytes ?? METADATA_MAX_PAYLOAD_BYTE_SIZE,
    timeout: opts?.timeoutMs ?? getTokenMetadataFetchTimeoutMs(),
  });
  if (!result.ok) {
    let msg = '';
    try {
      msg = await result.text();
    } catch (error) {
      // ignore errors from fetching error text
    }
    throw new Error(`Response ${result.status}: ${result.statusText} fetching ${url} - ${msg}`);
  }
  const resultString = await result.text();
  try {
    return JSON.parse(resultString) as Type;
  } catch (error) {
    throw new Error(`Error parsing response from ${url} as JSON: ${error}`);
  }
}
