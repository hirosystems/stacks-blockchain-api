import {
  ClarityType,
  ClarityValue,
  getAddressFromPrivateKey,
  hexToCV,
  makeRandomPrivKey,
  TransactionVersion,
  UIntCV,
} from '@stacks/transactions';
import { ChainID, getChainIDNetwork } from '../helpers';
import { ReadOnlyContractCallResponse, StacksCoreRpcClient } from '../core-rpc/client';
import { logger } from '../logger';
import * as LRUCache from 'lru-cache';

/** Fungible token metadata for Rosetta operations display */
export interface RosettaFtMetadata {
  symbol: string;
  decimals: number;
}

interface RosettaFtContractCallParams {
  address: string;
  contractAddress: string;
  contractName: string;
  functionName: string;
}

enum RosettaTokenMetadataErrorMode {
  /** Default mode. If a required token metadata is not found when it is needed for a response, the
   * API will issue a warning. */
  warning,
  /** If a required token metadata is not found, the API will throw an error. */
  error,
}

/**
 * Determines the token metadata error handling mode based on .env values.
 * @returns TokenMetadataMode
 */
function tokenMetadataErrorMode(): RosettaTokenMetadataErrorMode {
  switch (process.env['STACKS_API_TOKEN_METADATA_ERROR_MODE']) {
    case 'error':
      return RosettaTokenMetadataErrorMode.error;
    default:
      return RosettaTokenMetadataErrorMode.warning;
  }
}

function isFtMetadataEnabled() {
  const opt = process.env['STACKS_API_ENABLE_FT_METADATA']?.toLowerCase().trim();
  return opt === '1' || opt === 'true';
}

/**
 * LRU cache that keeps `RosettaFtMetadata` entries for FTs used in the Stacks chain and retrieved
 * by the Rosetta endpoints.
 */
const ftMetadataCache = new LRUCache<string, Promise<RosettaFtMetadata | undefined>>({
  max: 5_000,
});

/**
 * Retrieves FT metadata for tokens used by Rosetta. Keeps data in cache for faster future
 * retrieval.
 */
export class RosettaFtMetadataClient {
  private readonly chainId: ChainID;
  private readonly nodeRpcClient: StacksCoreRpcClient;

  constructor(chainId: ChainID) {
    this.chainId = chainId;
    this.nodeRpcClient = new StacksCoreRpcClient();
  }

  getFtMetadata(assetIdentifier: string): Promise<RosettaFtMetadata | undefined> {
    if (!isFtMetadataEnabled()) return Promise.resolve(undefined);
    const cachedMetadata = ftMetadataCache.get(assetIdentifier);
    if (cachedMetadata) return cachedMetadata;

    const resolvePromise = this.resolveFtMetadata(assetIdentifier);
    ftMetadataCache.set(assetIdentifier, resolvePromise);
    // If the promise is rejected, remove the entry from the cache so that it can be retried later.
    resolvePromise.catch(_ => {
      ftMetadataCache.del(assetIdentifier);
    });
    return resolvePromise;
  }

  private async resolveFtMetadata(assetIdentifier: string): Promise<RosettaFtMetadata | undefined> {
    const tokenContractId = assetIdentifier.split('::')[0];
    const [contractAddress, contractName] = tokenContractId.split('.');
    try {
      const address = getAddressFromPrivateKey(
        makeRandomPrivKey().data,
        getChainIDNetwork(this.chainId) === 'mainnet'
          ? TransactionVersion.Mainnet
          : TransactionVersion.Testnet
      );
      const symbol = await this.readStringFromContract({
        functionName: 'get-symbol',
        contractAddress,
        contractName,
        address,
      });
      const decimals = await this.readUIntFromContract({
        functionName: 'get-decimals',
        contractAddress,
        contractName,
        address,
      });
      if (symbol !== undefined && decimals !== undefined) {
        const metadata = { symbol, decimals: parseInt(decimals.toString()) };
        return metadata;
      }
    } catch (error) {
      if (tokenMetadataErrorMode() === RosettaTokenMetadataErrorMode.warning) {
        logger.warn(error, `FT metadata not found for token: ${assetIdentifier}`);
      } else {
        throw new Error(`FT metadata not found for token: ${assetIdentifier}`);
      }
    }
  }

  private async readStringFromContract(
    args: RosettaFtContractCallParams
  ): Promise<string | undefined> {
    const clarityValue = await this.makeReadOnlyContractCall(args);
    return this.checkAndParseString(clarityValue);
  }

  private async readUIntFromContract(
    args: RosettaFtContractCallParams
  ): Promise<bigint | undefined> {
    const clarityValue = await this.makeReadOnlyContractCall(args);
    const uintVal = this.checkAndParseUintCV(clarityValue);
    try {
      return BigInt(uintVal.value.toString());
    } catch (error) {
      throw new Error(`Invalid uint value '${uintVal}'`);
    }
  }

  private unwrapClarityType(clarityValue: ClarityValue): ClarityValue {
    let unwrappedClarityValue: ClarityValue = clarityValue;
    while (
      unwrappedClarityValue.type === ClarityType.ResponseOk ||
      unwrappedClarityValue.type === ClarityType.OptionalSome
    ) {
      unwrappedClarityValue = unwrappedClarityValue.value;
    }
    return unwrappedClarityValue;
  }

  private checkAndParseUintCV(responseCV: ClarityValue): UIntCV {
    const unwrappedClarityValue = this.unwrapClarityType(responseCV);
    if (unwrappedClarityValue.type === ClarityType.UInt) {
      return unwrappedClarityValue;
    }
    throw new Error(
      `Unexpected Clarity type '${unwrappedClarityValue.type}' while unwrapping uint`
    );
  }

  private checkAndParseString(responseCV: ClarityValue): string | undefined {
    const unwrappedClarityValue = this.unwrapClarityType(responseCV);
    if (
      unwrappedClarityValue.type === ClarityType.StringASCII ||
      unwrappedClarityValue.type === ClarityType.StringUTF8
    ) {
      return unwrappedClarityValue.data;
    } else if (unwrappedClarityValue.type === ClarityType.OptionalNone) {
      return undefined;
    }
    throw new Error(
      `Unexpected Clarity type '${unwrappedClarityValue.type}' while unwrapping string`
    );
  }

  private async makeReadOnlyContractCall(args: RosettaFtContractCallParams): Promise<ClarityValue> {
    let result: ReadOnlyContractCallResponse;
    try {
      result = await this.nodeRpcClient.sendReadOnlyContractCall(
        args.contractAddress,
        args.contractName,
        args.functionName,
        args.address,
        []
      );
    } catch (error) {
      throw new Error(`Error making read-only contract call: ${error}`);
    }
    if (!result.okay) {
      // Only runtime errors reported by the Stacks node should be retryable.
      if (
        result.cause.startsWith('Runtime') ||
        result.cause.startsWith('Unchecked(NoSuchContract')
      ) {
        throw new Error(`Runtime error while calling read-only function ${args.functionName}`);
      }
      throw new Error(`Error calling read-only function ${args.functionName}`);
    }
    return hexToCV(result.result);
  }
}
