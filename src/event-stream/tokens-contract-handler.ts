import * as child_process from 'child_process';
import {
  DataStore,
  DbFungibleTokenMetadata,
  DbNonFungibleTokenMetadata,
  DbTokenMetadataQueueEntry,
  TokenMetadataUpdateInfo,
} from '../datastore/common';
import {
  callReadOnlyFunction,
  ChainID,
  ClarityAbi,
  ClarityAbiFunction,
  ClarityType,
  ClarityValue,
  getAddressFromPrivateKey,
  makeRandomPrivKey,
  ReadOnlyFunctionOptions,
  TransactionVersion,
  uintCV,
  UIntCV,
} from '@stacks/transactions';
import { GetStacksNetwork } from '../bns-helpers';
import { logError, logger, parseDataUrl, REPO_DIR, stopwatch } from '../helpers';
import { StacksNetwork } from '@stacks/network';
import PQueue from 'p-queue';
import * as querystring from 'querystring';
import fetch from 'node-fetch';
import { Evt } from 'evt';

/**
 * The maximum number of token metadata parsing operations that can be ran concurrently before
 * being added to a FIFO queue.
 */
const TOKEN_METADATA_PARSING_CONCURRENCY_LIMIT = 5;

/**
 * Amount of milliseconds to wait when fetching token metadata.
 * If the fetch takes longer then it throws and the metadata is not processed.
 */
const METADATA_FETCH_TIMEOUT_MS: number = 10_000; // 10 seconds

/**
 * The maximum number of bytes of metadata to fetch.
 * If the fetch encounters more bytes than this limit it throws and the metadata is not processed.
 */
const METADATA_MAX_PAYLOAD_BYTE_SIZE = 1_000_000; // 1 megabyte

const PUBLIC_IPFS = 'https://ipfs.io';

export function isFtMetadataEnabled() {
  const opt = process.env['STACKS_API_ENABLE_FT_METADATA']?.toLowerCase().trim();
  return opt === '1' || opt === 'true';
}

export function isNftMetadataEnabled() {
  const opt = process.env['STACKS_API_ENABLE_NFT_METADATA']?.toLowerCase().trim();
  return opt === '1' || opt === 'true';
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

/**
 * Checks if the given ABI contains functions from FT or NFT metadata standards (e.g. sip-09, sip-10) which can be resolved.
 * The function also checks if the server has FT and/or NFT metadata processing enabled.
 */
export function isProcessableTokenMetadata(abi: ClarityAbi): boolean {
  return (
    (isFtMetadataEnabled() && isCompliantFt(abi)) || (isNftMetadataEnabled() && isCompliantNft(abi))
  );
}

function isCompliantNft(abi: ClarityAbi): boolean {
  if (abi.non_fungible_tokens.length > 0) {
    if (abiContains(abi, NFT_FUNCTIONS)) {
      return true;
    }
  }
  return false;
}

function isCompliantFt(abi: ClarityAbi): boolean {
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

class TokensContractHandler {
  readonly contractAddress: string;
  readonly contractName: string;
  readonly contractId: string;
  readonly txId: string;
  readonly dbQueueId: number;
  private readonly contractAbi: ClarityAbi;
  private readonly db: DataStore;
  private readonly randomPrivKey = makeRandomPrivKey();
  private readonly chainId: ChainID;
  private readonly stacksNetwork: StacksNetwork;
  private readonly address: string;
  private readonly tokenKind: 'ft' | 'nft';

  constructor(args: TokenHandlerArgs) {
    [this.contractAddress, this.contractName] = args.contractId.split('.');
    this.contractId = args.contractId;
    this.contractAbi = args.smartContractAbi;
    this.db = args.datastore;
    this.chainId = args.chainId;
    this.txId = args.txId;
    this.dbQueueId = args.dbQueueId;

    this.stacksNetwork = GetStacksNetwork(this.chainId);
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
    try {
      if (this.tokenKind === 'ft') {
        await this.handleFtContract();
      } else if (this.tokenKind === 'nft') {
        await this.handleNftContract();
      } else {
        throw new Error(`Unexpected token kind '${this.tokenKind}'`);
      }
    } finally {
      logger.info(
        `[token-metadata] finished processing ${this.contractId} in ${sw.getElapsed()} ms`
      );
    }
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
   * fetch Fungible contract metadata
   */
  private async handleFtContract() {
    let metadata: FtTokenMetadata | undefined;
    let contractCallName: string | undefined;
    let contractCallUri: string | undefined;
    let contractCallSymbol: string | undefined;
    let contractCallDecimals: number | undefined;
    let imgUrl: string | undefined;

    try {
      // get name value
      contractCallName = await this.readStringFromContract('get-name', []);

      // get token uri
      contractCallUri = await this.readStringFromContract('get-token-uri', []);

      // get token symbol
      contractCallSymbol = await this.readStringFromContract('get-symbol', []);

      // get decimals
      const decimalsResult = await this.readUIntFromContract('get-decimals', []);
      if (decimalsResult) {
        contractCallDecimals = Number(decimalsResult.toString());
      }

      if (contractCallUri) {
        try {
          metadata = await this.getMetadataFromUri<FtTokenMetadata>(contractCallUri);
          metadata = this.patchTokenMetadataImageUri(metadata);
        } catch (error) {
          logger.warn(
            `[token-metadata] error fetching metadata while processing FT contract ${this.contractId}`,
            error
          );
        }
      }

      if (metadata?.imageUri) {
        try {
          const normalizedUrl = this.getImageUrl(metadata.imageUri);
          imgUrl = await this.processImageUrl(normalizedUrl);
        } catch (error) {
          logger.warn(
            `[token-metadata] error handling image url while processing FT contract ${this.contractId}`,
            error
          );
        }
      }
    } catch (error) {
      // Note: something is wrong with the above error handling if this is ever reached.
      logError(
        `[token-metadata] unexpected error processing FT contract ${this.contractId}`,
        error
      );
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

    //store metadata in db
    await this.storeFtMetadata(fungibleTokenMetadata);
  }

  /**
   * fetch Non Fungible contract metadata
   */
  private async handleNftContract() {
    let metadata: NftTokenMetadata | undefined;
    let contractCallUri: string | undefined;
    let imgUrl: string | undefined;

    try {
      // TODO: This is incorrectly attempting to fetch the metadata for a specific
      // NFT and applying it to the entire NFT type/contract. A new SIP needs created
      // to define how generic metadata for an NFT type/contract should be retrieved.
      // In the meantime, this will often fail or result in weird data, but at least
      // the NFT type enumeration endpoints will have data like the contract ID and txid.

      // TODO: this should instead use the SIP-012 draft https://github.com/stacksgov/sips/pull/18
      // function `(get-nft-meta () (response (optional {name: (string-uft8 30), image: (string-ascii 255)}) uint))`

      contractCallUri = await this.readStringFromContract('get-token-uri', [uintCV(0)]);
      if (contractCallUri) {
        try {
          metadata = await this.getMetadataFromUri<FtTokenMetadata>(contractCallUri);
          metadata = this.patchTokenMetadataImageUri(metadata);
        } catch (error) {
          logger.warn(
            `[token-metadata] error fetching metadata while processing NFT contract ${this.contractId}`,
            error
          );
        }
      }

      if (metadata?.imageUri) {
        try {
          const normalizedUrl = this.getImageUrl(metadata.imageUri);
          imgUrl = await this.processImageUrl(normalizedUrl);
        } catch (error) {
          logger.warn(
            `[token-metadata] error handling image url while processing NFT contract ${this.contractId}`,
            error
          );
        }
      }
    } catch (error) {
      // Note: something is wrong with the above error handling if this is ever reached.
      logError(
        `[token-metadata] unexpected error processing NFT contract ${this.contractId}`,
        error
      );
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
    await this.storeNftMetadata(nonFungibleTokenMetadata);
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

  /**
   * Make readonly contract call
   */
  private async makeReadOnlyContractCall(
    functionName: string,
    functionArgs: ClarityValue[]
  ): Promise<ClarityValue> {
    const txOptions: ReadOnlyFunctionOptions = {
      senderAddress: this.address,
      contractAddress: this.contractAddress,
      contractName: this.contractName,
      functionName: functionName,
      functionArgs: functionArgs,
      network: this.stacksNetwork,
    };
    return await callReadOnlyFunction(txOptions);
  }

  private async readStringFromContract(
    functionName: string,
    functionArgs: ClarityValue[]
  ): Promise<string | undefined> {
    try {
      const clarityValue = await this.makeReadOnlyContractCall(functionName, functionArgs);
      const stringVal = this.checkAndParseString(clarityValue);
      return stringVal;
    } catch (error) {
      logger.warn(
        `[token-metadata] error extracting string with contract function call '${functionName}' while processing ${this.contractId}`,
        error
      );
    }
  }

  private async readUIntFromContract(
    functionName: string,
    functionArgs: ClarityValue[]
  ): Promise<bigint | undefined> {
    try {
      const clarityValue = await this.makeReadOnlyContractCall(functionName, functionArgs);
      const uintVal = this.checkAndParseUintCV(clarityValue);
      return BigInt(uintVal.value.toString());
    } catch (error) {
      logger.warn(
        `[token-metadata] error extracting string with contract function call '${functionName}' while processing ${this.contractId}`,
        error
      );
    }
  }

  /**
   * Store ft metadata to db
   */
  private async storeFtMetadata(ftMetadata: DbFungibleTokenMetadata) {
    try {
      await this.db.updateFtMetadata(ftMetadata, this.dbQueueId);
    } catch (error) {
      throw new Error(`Error occurred while updating FT metadata ${error}`);
    }
  }

  /**
   * Store NFT Metadata to db
   */
  private async storeNftMetadata(nftMetadata: DbNonFungibleTokenMetadata) {
    try {
      await this.db.updateNFtMetadata(nftMetadata, this.dbQueueId);
    } catch (error) {
      throw new Error(`Error occurred while updating NFT metadata ${error}`);
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

  private checkAndParseString(responseCV: ClarityValue): string {
    const unwrappedClarityValue = this.unwrapClarityType(responseCV);
    if (
      unwrappedClarityValue.type === ClarityType.StringASCII ||
      unwrappedClarityValue.type === ClarityType.StringUTF8
    ) {
      return unwrappedClarityValue.data;
    }
    throw new Error(
      `Unexpected Clarity type '${unwrappedClarityValue.type}' while unwrapping string`
    );
  }
}

export class TokensProcessorQueue {
  readonly queue: PQueue;
  readonly db: DataStore;
  readonly chainId: ChainID;

  readonly processStartedEvent: Evt<{
    contractId: string;
    txId: string;
  }> = new Evt();

  readonly processEndEvent: Evt<{
    contractId: string;
    txId: string;
  }> = new Evt();

  /** The entries currently queued for processing in memory, keyed by the queue entry db id. */
  readonly queuedEntries: Map<number, TokenMetadataUpdateInfo> = new Map();

  readonly onTokenMetadataUpdateQueued: (entry: TokenMetadataUpdateInfo) => void;

  constructor(db: DataStore, chainId: ChainID) {
    this.db = db;
    this.chainId = chainId;
    this.queue = new PQueue({ concurrency: TOKEN_METADATA_PARSING_CONCURRENCY_LIMIT });
    this.onTokenMetadataUpdateQueued = entry => this.queueHandler(entry);
    this.db.on('tokenMetadataUpdateQueued', this.onTokenMetadataUpdateQueued);
  }

  close() {
    this.db.off('tokenMetadataUpdateQueued', this.onTokenMetadataUpdateQueued);
    this.queue.pause();
    this.queue.clear();
  }

  async drainDbQueue(): Promise<void> {
    let entries: DbTokenMetadataQueueEntry[] = [];
    do {
      if (this.queue.isPaused) {
        return;
      }
      const queuedEntries = [...this.queuedEntries.keys()];
      entries = await this.db.getTokenMetadataQueue(
        TOKEN_METADATA_PARSING_CONCURRENCY_LIMIT,
        queuedEntries
      );
      for (const entry of entries) {
        await this.queueHandler(entry);
      }
      await this.queue.onEmpty();
      // await this.queue.onIdle();
    } while (entries.length > 0 || this.queuedEntries.size > 0);
  }

  async checkDbQueue(): Promise<void> {
    if (this.queue.isPaused) {
      return;
    }
    const queuedEntries = [...this.queuedEntries.keys()];
    const limit = TOKEN_METADATA_PARSING_CONCURRENCY_LIMIT - this.queuedEntries.size;
    if (limit > 0) {
      const entries = await this.db.getTokenMetadataQueue(
        TOKEN_METADATA_PARSING_CONCURRENCY_LIMIT,
        queuedEntries
      );
      for (const entry of entries) {
        await this.queueHandler(entry);
      }
    }
  }

  async queueHandler(queueEntry: TokenMetadataUpdateInfo) {
    if (
      this.queuedEntries.has(queueEntry.queueId) ||
      this.queuedEntries.size >= this.queue.concurrency
    ) {
      return;
    }
    const contractQuery = await this.db.getSmartContract(queueEntry.contractId);
    if (!contractQuery.found) {
      return;
    }
    logger.info(
      `[token-metadata] queueing token contract for processing: ${queueEntry.contractId} from tx ${queueEntry.txId}`
    );
    this.queuedEntries.set(queueEntry.queueId, queueEntry);

    const contractAbi: ClarityAbi = JSON.parse(contractQuery.result.abi);
    const tokenContractHandler = new TokensContractHandler({
      contractId: queueEntry.contractId,
      smartContractAbi: contractAbi,
      datastore: this.db,
      chainId: this.chainId,
      txId: queueEntry.txId,
      dbQueueId: queueEntry.queueId,
    });

    void this.queue
      .add(async () => {
        this.processStartedEvent.post({
          contractId: queueEntry.contractId,
          txId: queueEntry.txId,
        });
        await tokenContractHandler.start();
      })
      .catch(error => {
        logError(
          `[token-metadata] error processing token contract: ${tokenContractHandler.contractAddress} ${tokenContractHandler.contractName} from tx ${tokenContractHandler.txId}`,
          error
        );
      })
      .finally(() => {
        this.queuedEntries.delete(queueEntry.queueId);
        this.processEndEvent.post({
          contractId: queueEntry.contractId,
          txId: queueEntry.txId,
        });
        logger.info(
          `[token-metadata] finished token contract processing for: ${queueEntry.contractId} from tx ${queueEntry.txId}`
        );
        if (this.queuedEntries.size < this.queue.concurrency) {
          void this.checkDbQueue();
        }
      });
  }
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
    timeout: opts?.timeoutMs ?? METADATA_FETCH_TIMEOUT_MS,
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
