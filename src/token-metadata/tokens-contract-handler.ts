import * as child_process from 'child_process';
import {
  DataStore,
  DbFungibleTokenMetadata,
  DbNonFungibleTokenMetadata,
} from '../datastore/common';
import {
  ChainID,
  ClarityAbi,
  ClarityType,
  ClarityValue,
  getAddressFromPrivateKey,
  hexToCV,
  makeRandomPrivKey,
  TransactionVersion,
  uintCV,
  UIntCV,
} from '@stacks/transactions';
import { GetStacksNetwork } from '../bns-helpers';
import { logError, logger, parseDataUrl, REPO_DIR, stopwatch } from '../helpers';
import { StacksNetwork } from '@stacks/network';
import * as querystring from 'querystring';
import { isCompliantFt, isCompliantNft, performFetch } from './helpers';
import { StacksCoreRpcClient } from 'src/core-rpc/client';

/**
 * Amount of milliseconds to wait when fetching token metadata.
 * If the fetch takes longer then it throws and the metadata is not processed.
 */
export const METADATA_FETCH_TIMEOUT_MS: number = 10_000; // 10 seconds

/**
 * The maximum number of bytes of metadata to fetch.
 * If the fetch encounters more bytes than this limit it throws and the metadata is not processed.
 */
export const METADATA_MAX_PAYLOAD_BYTE_SIZE = 1_000_000; // 1 megabyte

const PUBLIC_IPFS = 'https://ipfs.io';

export enum TokenMetadataErrorMode {
  /**
   * Default mode. If a required token metadata is not found, the API will issue a warning.
   */
  warning,
  /**
   * If a required token metadata is not found, the API will throw an error.
   */
  error,
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

/**
 * A token metadata fetch/process error caused by something that we can try to do again later.
 */
class RetryableTokenMetadataError extends Error {
  constructor(message: string) {
    super(message);
    this.message = message;
    this.name = this.constructor.name;
  }
}

interface NftTokenMetadata {
  name: string;
  imageUri: string;
  description: string;
}

interface FtTokenMetadata {
  name: string;
  imageUri: string;
  description: string;
}

interface TokenHandlerArgs {
  contractId: string;
  smartContractAbi: ClarityAbi;
  datastore: DataStore;
  chainId: ChainID;
  txId: string;
  dbQueueId: number;
}

export class TokensContractHandler {
  readonly contractAddress: string;
  readonly contractName: string;
  readonly contractId: string;
  readonly txId: string;
  readonly dbQueueId: number;
  private readonly db: DataStore;
  private readonly randomPrivKey = makeRandomPrivKey();
  private readonly chainId: ChainID;
  private readonly address: string;
  private readonly tokenKind: 'ft' | 'nft';
  private readonly nodeRpcClient: StacksCoreRpcClient;

  constructor(args: TokenHandlerArgs) {
    [this.contractAddress, this.contractName] = args.contractId.split('.');
    this.contractId = args.contractId;
    this.db = args.datastore;
    this.chainId = args.chainId;
    this.txId = args.txId;
    this.dbQueueId = args.dbQueueId;
    this.nodeRpcClient = new StacksCoreRpcClient();

    this.address = getAddressFromPrivateKey(
      this.randomPrivKey.data,
      this.chainId === ChainID.Mainnet ? TransactionVersion.Mainnet : TransactionVersion.Testnet
    );
    if (isCompliantFt(args.smartContractAbi)) {
      this.tokenKind = 'ft';
    } else if (isCompliantNft(args.smartContractAbi)) {
      this.tokenKind = 'nft';
    } else {
      throw new Error(
        `TokenContractHandler passed an ABI that isn't compliant to FT or NFT standards`
      );
    }
  }

  async start() {
    logger.info(
      `[token-metadata] found ${
        this.tokenKind === 'ft' ? 'sip-010-ft-standard' : 'sip-009-nft-standard'
      } compliant contract ${this.contractId} in tx ${this.txId}, begin retrieving metadata...`
    );
    const sw = stopwatch();
    // This try/catch block will catch any and all errors that are generated while processing metadata
    // (contract call errors, parse errors, timeouts, etc.). Fortunately, each of them were previously tagged
    // as retryable or not retryable so we'll make a decision here about what to do in each case.
    // If we choose to retry, this queue entry will simply not be marked as `processed = true` so it can be
    // picked up by the `TokensProcessorQueue` at a later time.
    let processingFinished = false;
    try {
      if (this.tokenKind === 'ft') {
        await this.handleFtContract();
      } else if (this.tokenKind === 'nft') {
        await this.handleNftContract();
      }
      processingFinished = true;
    } catch (error) {
      if (error instanceof RetryableTokenMetadataError) {
        // FIXME: check strict mode and max retry attempts
        logger.info(
          `[token-metadata] a recoverable error happened while processing ${this.contractId}, trying again later: ${error}`
        );
      } else {
        // Something went wrong but oh well, nvm.
        processingFinished = true;
      }
    } finally {
      if (processingFinished) {
        await this.db.updateProcessedTokenMetadataQueueEntry(this.dbQueueId);
        logger.info(
          `[token-metadata] finished processing ${this.contractId} in ${sw.getElapsed()} ms`
        );
      }
    }
  }

  /**
   * fetch Fungible contract metadata
   */
  private async handleFtContract() {
    const contractCallName = await this.readStringFromContract('get-name');
    const contractCallUri = await this.readStringFromContract('get-token-uri');
    const contractCallSymbol = await this.readStringFromContract('get-symbol');

    let contractCallDecimals: number | undefined;
    const decimalsResult = await this.readUIntFromContract('get-decimals');
    if (decimalsResult) {
      contractCallDecimals = Number(decimalsResult.toString());
    }

    let metadata: FtTokenMetadata | undefined;
    if (contractCallUri) {
      metadata = await this.getMetadataFromUri<FtTokenMetadata>(contractCallUri);
      metadata = this.patchTokenMetadataImageUri(metadata);
    }

    let imgUrl: string | undefined;
    if (metadata?.imageUri) {
      const normalizedUrl = this.getImageUrl(metadata.imageUri);
      imgUrl = await this.processImageUrl(normalizedUrl);
    }

    const fungibleTokenMetadata: DbFungibleTokenMetadata = {
      token_uri: contractCallUri ?? '',
      name: contractCallName ?? metadata?.name ?? '', // prefer the on-chain name
      description: metadata?.description ?? '',
      image_uri: imgUrl ?? '',
      image_canonical_uri: metadata?.imageUri ?? '',
      symbol: contractCallSymbol ?? '',
      decimals: contractCallDecimals ?? 0,
      contract_id: this.contractId,
      tx_id: this.txId,
      sender_address: this.contractAddress,
    };
    await this.db.updateFtMetadata(fungibleTokenMetadata);
  }

  /**
   * fetch Non Fungible contract metadata
   */
  private async handleNftContract() {
    // TODO: This is incorrectly attempting to fetch the metadata for a specific
    // NFT and applying it to the entire NFT type/contract. A new SIP needs created
    // to define how generic metadata for an NFT type/contract should be retrieved.
    // In the meantime, this will often fail or result in weird data, but at least
    // the NFT type enumeration endpoints will have data like the contract ID and txid.

    // TODO: this should instead use the SIP-012 draft https://github.com/stacksgov/sips/pull/18
    // function `(get-nft-meta () (response (optional {name: (string-uft8 30), image: (string-ascii 255)}) uint))`

    let metadata: NftTokenMetadata | undefined;
    const contractCallUri = await this.readStringFromContract('get-token-uri', [uintCV(0)]);
    if (contractCallUri) {
      metadata = await this.getMetadataFromUri<FtTokenMetadata>(contractCallUri);
      metadata = this.patchTokenMetadataImageUri(metadata);
    }

    let imgUrl: string | undefined;
    if (metadata?.imageUri) {
      const normalizedUrl = this.getImageUrl(metadata.imageUri);
      imgUrl = await this.processImageUrl(normalizedUrl);
    }

    const nonFungibleTokenMetadata: DbNonFungibleTokenMetadata = {
      token_uri: contractCallUri ?? '',
      name: metadata?.name ?? '',
      description: metadata?.description ?? '',
      image_uri: imgUrl ?? '',
      image_canonical_uri: metadata?.imageUri ?? '',
      contract_id: `${this.contractId}`,
      tx_id: this.txId,
      sender_address: this.contractAddress,
    };
    await this.db.updateNFtMetadata(nonFungibleTokenMetadata);
  }

  /**
   * Token metadata schema for 'image uri' is not well defined or adhered to.
   * This function looks for a handful of possible properties that could be used to
   * specify the image, and returns a metadata object with a normalized image property.
   */
  private patchTokenMetadataImageUri<T extends { imageUri: string }>(metadata: T): T {
    // compare using lowercase
    const allowedImageProperties = ['image', 'imageurl', 'imageuri', 'image_url', 'image_uri'];
    const objectKeys = new Map(Object.keys(metadata).map(prop => [prop.toLowerCase(), prop]));
    for (const possibleProp of allowedImageProperties) {
      const existingProp = objectKeys.get(possibleProp);
      if (existingProp) {
        const imageUriVal = (metadata as Record<string, string>)[existingProp];
        if (typeof imageUriVal !== 'string') {
          continue;
        }
        return {
          ...metadata,
          imageUri: imageUriVal,
        };
      }
    }
    return { ...metadata };
  }

  /**
   * If an external image processor script is configured, then it will process the given image URL for the purpose
   * of caching on a CDN (or whatever else it may be created to do). The script is expected to return a new URL
   * for the image.
   * If the script is not configured, then the original URL is returned immediately.
   * If a data-uri is passed, it is also immediately returned without being passed to the script.
   */
  private async processImageUrl(imgUrl: string): Promise<string> {
    const imageCacheProcessor = process.env['STACKS_API_IMAGE_CACHE_PROCESSOR'];
    if (!imageCacheProcessor) {
      return imgUrl;
    }
    if (imgUrl.startsWith('data:')) {
      return imgUrl;
    }
    const { code, stdout, stderr } = await new Promise<{
      code: number;
      stdout: string;
      stderr: string;
    }>((resolve, reject) => {
      const cp = child_process.spawn(imageCacheProcessor, [imgUrl], { cwd: REPO_DIR });
      let stdout = '';
      let stderr = '';
      cp.stdout.on('data', data => (stdout += data));
      cp.stderr.on('data', data => (stderr += data));
      cp.on('close', code => resolve({ code: code ?? 0, stdout, stderr }));
      cp.on('error', error => reject(error));
    });
    if (code !== 0 && stderr) {
      console.warn(`[token-metadata] stderr from STACKS_API_IMAGE_CACHE_PROCESSOR: ${stderr}`);
    }
    const result = stdout.trim();
    try {
      const url = new URL(result);
      return url.toString();
    } catch (error) {
      throw new Error(
        `Image processing script returned an invalid url for ${imgUrl}: ${result}, stderr: ${stderr}`
      );
    }
  }

  /**
   * Helper method for creating http/s url for supported protocols.
   * URLs with `http` or `https` protocols are returned as-is.
   * URLs with `ipfs` or `ipns` protocols are returned with as an `https` url
   * using a public IPFS gateway.
   */
  private getFetchableUrl(uri: string): URL {
    const parsedUri = new URL(uri);
    if (parsedUri.protocol === 'http:' || parsedUri.protocol === 'https:') return parsedUri;
    if (parsedUri.protocol === 'ipfs:')
      return new URL(`${PUBLIC_IPFS}/${parsedUri.host}${parsedUri.pathname}`);

    if (parsedUri.protocol === 'ipns:')
      return new URL(`${PUBLIC_IPFS}/${parsedUri.host}${parsedUri.pathname}`);

    throw new Error(`Unsupported uri protocol: ${uri}`);
  }

  private getImageUrl(uri: string): string {
    // Support images embedded in a Data URL
    if (new URL(uri).protocol === 'data:') {
      // const dataUrl = ParseDataUrl(uri);
      const dataUrl = parseDataUrl(uri);
      if (!dataUrl) {
        throw new Error(`Data URL could not be parsed: ${uri}`);
      }
      if (!dataUrl.mediaType?.startsWith('image/')) {
        throw new Error(`Token image is a Data URL with a non-image media type: ${uri}`);
      }
      return uri;
    }
    const fetchableUrl = this.getFetchableUrl(uri);
    return fetchableUrl.toString();
  }

  /**
   * Fetch metadata from uri
   */
  private async getMetadataFromUri<Type>(token_uri: string): Promise<Type> {
    // Support JSON embedded in a Data URL
    if (new URL(token_uri).protocol === 'data:') {
      const dataUrl = parseDataUrl(token_uri);
      if (!dataUrl) {
        throw new Error(`Data URL could not be parsed: ${token_uri}`);
      }
      let content: string;
      // If media type is omitted it should default to percent-encoded `text/plain;charset=US-ASCII`
      // https://developer.mozilla.org/en-US/docs/Web/HTTP/Basics_of_HTTP/Data_URIs#syntax
      // If media type is specified but without base64 then encoding is ambiguous, so check for
      // percent-encoding or assume a literal string compatible with utf8. Because we're expecting
      // a JSON object we can reliable check for a leading `%` char, otherwise assume unescaped JSON.
      if (dataUrl.base64) {
        content = Buffer.from(dataUrl.data, 'base64').toString('utf8');
      } else if (dataUrl.data.startsWith('%')) {
        content = querystring.unescape(dataUrl.data);
      } else {
        content = dataUrl.data;
      }
      try {
        return JSON.parse(content) as Type;
      } catch (error) {
        throw new Error(`Data URL could not be parsed as JSON: ${token_uri}`);
      }
    }
    const httpUrl = this.getFetchableUrl(token_uri);
    return await performFetch(httpUrl.toString(), {
      timeoutMs: METADATA_FETCH_TIMEOUT_MS,
      maxResponseBytes: METADATA_MAX_PAYLOAD_BYTE_SIZE,
    });
  }

  private async makeReadOnlyContractCall(
    functionName: string,
    functionArgs: ClarityValue[]
  ): Promise<ClarityValue> {
    const result = await this.nodeRpcClient.sendReadOnlyContractCall(
      this.contractAddress,
      this.contractName,
      functionName,
      this.address,
      functionArgs
    );
    if (!result.okay) {
      // Only runtime errors reported by the Stacks node are retryable during a contract call.
      if (result.cause.startsWith('Runtime')) {
        throw new RetryableTokenMetadataError(
          `Runtime error while calling read-only function ${functionName}`
        );
      }
      throw new Error(`Error calling read-only function ${functionName}`);
    }
    return hexToCV(result.result);
  }

  private async readStringFromContract(
    functionName: string,
    functionArgs: ClarityValue[] = []
  ): Promise<string | undefined> {
    const clarityValue = await this.makeReadOnlyContractCall(functionName, functionArgs);
    return this.checkAndParseString(clarityValue);
  }

  private async readUIntFromContract(
    functionName: string,
    functionArgs: ClarityValue[] = []
  ): Promise<bigint | undefined> {
    const clarityValue = await this.makeReadOnlyContractCall(functionName, functionArgs);
    const uintVal = this.checkAndParseUintCV(clarityValue);
    try {
      return BigInt(uintVal.value.toString());
    } catch (error) {
      throw new RetryableTokenMetadataError(`Invalid uint value '${uintVal}'`);
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
    throw new RetryableTokenMetadataError(
      `Unexpected Clarity type '${unwrappedClarityValue.type}' while unwrapping uint`
    );
  }

  private checkAndParseString(responseCV: ClarityValue): string {
    const unwrappedClarityValue = this.unwrapClarityType(responseCV);
    if (
      unwrappedClarityValue.type === ClarityType.StringASCII ||
      unwrappedClarityValue.type === ClarityType.StringUTF8
    ) {
      return unwrappedClarityValue.data;
    }
    throw new RetryableTokenMetadataError(
      `Unexpected Clarity type '${unwrappedClarityValue.type}' while unwrapping string`
    );
  }
}
