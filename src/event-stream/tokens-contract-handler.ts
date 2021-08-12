import {
  DataStore,
  DbFungibleTokenMetadata,
  DbNonFungibleTokenMetadata,
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
  StringAsciiCV,
  StringUtf8CV,
  TransactionVersion,
  uintCV,
  UIntCV,
} from '@stacks/transactions';
import { GetStacksNetwork } from '../bns-helpers';
import { logError, logger, parseDataUrl, stopwatch } from '../helpers';
import { StacksNetwork } from '@stacks/network';
import PQueue from 'p-queue';
import * as querystring from 'querystring';
import fetch from 'node-fetch';

// The maximum number of token metadata parsing operations that can be ran concurrently before
// being added to a FIFO queue.
const TOKEN_METADATA_PARSING_CONCURRENCY_LIMIT = 5;

const PUBLIC_IPFS = 'https://ipfs.io';

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

export interface TokenHandlerArgs {
  contractAddress: string;
  contractName: string;
  smartContractAbi: ClarityAbi;
  datastore: DataStore;
  chainId: ChainID;
  tx_id: string;
}

export class TokensProcessorQueue {
  readonly queue: PQueue;
  constructor() {
    this.queue = new PQueue({ concurrency: TOKEN_METADATA_PARSING_CONCURRENCY_LIMIT });
  }
  queueHandler(tokenContractHandler: TokensContractHandler) {
    // TODO: This could get backed up quite a bit, for example while syncing from scratch.
    // If the process is restarted, this queue is not currently persisted and all the queued
    // contracts will be thrown away. Eventually this should probably persist the queue in the db.

    void this.queue
      .add(async () => {
        await tokenContractHandler.start();
      })
      .catch(error => {
        // TODO: should this be a fatal error?
        logError(
          `[token-metadata] error processing token contract: ${tokenContractHandler.contractAddress} ${tokenContractHandler.contractName} from tx ${tokenContractHandler.txId}`,
          error
        );
      });
  }
}

export class TokensContractHandler {
  readonly contractAddress: string;
  readonly contractName: string;
  readonly contractId: string;
  readonly txId: string;
  private readonly contractAbi: ClarityAbi;
  private readonly db: DataStore;
  private readonly randomPrivKey = makeRandomPrivKey();
  private readonly chainId: ChainID;
  private readonly stacksNetwork: StacksNetwork;
  private readonly address: string;

  constructor(args: TokenHandlerArgs) {
    this.contractAddress = args.contractAddress;
    this.contractName = args.contractName;
    this.contractId = `${args.contractAddress}.${args.contractName}`;
    this.contractAbi = args.smartContractAbi;
    this.db = args.datastore;
    this.chainId = args.chainId;
    this.txId = args.tx_id;

    this.stacksNetwork = GetStacksNetwork(this.chainId);
    this.address = getAddressFromPrivateKey(
      this.randomPrivKey.data,
      this.chainId === ChainID.Mainnet ? TransactionVersion.Mainnet : TransactionVersion.Testnet
    );
  }
  async start() {
    if (this.contractAbi.fungible_tokens.length > 0) {
      if (this.isCompliant(FT_FUNCTIONS)) {
        logger.info(
          `[token-metadata] found sip-010-ft-standard compliant contract ${this.contractId} in tx ${this.txId}, begin retrieving metadata...`
        );
        const sw = stopwatch();
        try {
          await this.handleFtContract();
        } finally {
          logger.info(
            `[token-metadata] finished processing FT ${this.contractId} in ${sw.getElapsed()} ms`
          );
        }
      }
    }
    if (this.contractAbi.non_fungible_tokens.length > 0) {
      if (this.isCompliant(NFT_FUNCTIONS)) {
        logger.info(
          `[token-metadata] found sip-009-nft-standard compliant contract ${this.contractId} in tx ${this.txId}, begin retrieving metadata...`
        );
        const sw = stopwatch();
        try {
          await this.handleNftContract();
        } finally {
          logger.info(
            `[token-metadata] finished processing NFT ${this.contractId} in ${sw.getElapsed()} ms`
          );
        }
      }
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
      image_uri: metadata?.imageUri ? this.getImageUrl(metadata.imageUri) : '',
      image_canonical_uri: metadata?.imageUri || '',
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

    try {
      // TODO: This is incorrectly attempting to fetch the metadata for a specific
      // NFT and applying it to the entire NFT type/contract. A new SIP needs created
      // to define how generic metadata for an NFT type/contract should be retrieved.
      // In the meantime, this will often fail or result in weird data, but at least
      // the NFT type enumeration endpoints will have data like the contract ID and txid.
      const tokenId = await this.readUIntFromContract('get-last-token-id', []);
      if (tokenId) {
        contractCallUri = await this.readStringFromContract('get-token-uri', [
          uintCV(tokenId.toString()),
        ]);
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
      image_uri: metadata?.imageUri ? this.getImageUrl(metadata.imageUri) : '',
      image_canonical_uri: metadata?.imageUri ?? '',
      contract_id: `${this.contractId}`,
      tx_id: this.txId,
      sender_address: this.contractAddress,
    };
    await this.storeNftMetadata(nonFungibleTokenMetadata);
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
   * fetch metadata from uri
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
    return await performFetch(httpUrl.toString());
  }

  /**
   * make readonly contract call
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
  private async storeFtMetadata(ft_metadata: DbFungibleTokenMetadata) {
    try {
      await this.db.updateFtMetadata(ft_metadata);
    } catch (error) {
      throw new Error(`error occurred while updating FT metadata ${error}`);
    }
  }

  /**
   * Store NFT Metadata to db
   */
  private async storeNftMetadata(nft_metadata: DbNonFungibleTokenMetadata) {
    try {
      await this.db.updateNFtMetadata(nft_metadata);
    } catch (error) {
      throw new Error(`error occurred while updating NFT metadata ${error}`);
    }
  }

  /**
   * This method check if the contract is compliance with sip-09 and sip-10
   * Ref: https://github.com/stacksgov/sips/tree/main/sips
   */
  private isCompliant(standardFunction: ClarityAbiFunction[]): boolean {
    return standardFunction.every(abiFun => this.findFunction(abiFun, this.contractAbi.functions));
  }

  /**
   * check if the fun  exist in the function list
   * @param fun - function to be found
   * @param functionList - list of functions
   * @returns - true if function is in the list false otherwise
   */
  private findFunction(fun: ClarityAbiFunction, functionList: ClarityAbiFunction[]): boolean {
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

/**
 * This method checks if a the contract abi has fungible or non fungible tokens
 * @param contract_abi -  clarity abi of the contract
 * @returns true if has tokens false if does not
 */
export function hasTokens(contract_abi: ClarityAbi): boolean {
  return contract_abi.fungible_tokens.length > 0 || contract_abi.non_fungible_tokens.length > 0;
}

export async function performFetch<Type>(url: string): Promise<Type> {
  const MAX_PAYLOAD_SIZE = 1_000_000; // 1 megabyte
  const result = await fetch(url, { size: MAX_PAYLOAD_SIZE });
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
