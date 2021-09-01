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
  UIntCV,
} from '@stacks/transactions';
import { GetStacksNetwork } from '../bns-helpers';
import { logError, logger, parseDataUrl } from '../helpers';
import { StacksNetwork } from '@stacks/network';
import PQueue from 'p-queue';
import * as querystring from 'querystring';
import fetch from 'node-fetch';

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
  imageUrl: string;
  description: string;
}

interface FtTokenMetadata {
  name: string;
  image: string;
  description: string;
}

export class TokensProcessorQueue {
  readonly queue: PQueue;
  constructor() {
    this.queue = new PQueue({ concurrency: 1 });
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
          `Error processing token contract: ${tokenContractHandler.contractAddress} ${tokenContractHandler.contractName}`,
          error
        );
      });
  }
}

export class TokensContractHandler {
  contractAddress: string;
  contractName: string;
  private contractAbi: ClarityAbi;
  private db: DataStore;
  private randomPrivKey = makeRandomPrivKey();
  private chainId: ChainID;
  private stacksNetwork: StacksNetwork;
  private address: string;

  constructor(
    contractAddress: string,
    contractName: string,
    smartContractAbi: ClarityAbi,
    datastore: DataStore,
    chainId: ChainID
  ) {
    this.contractAddress = contractAddress;
    this.contractName = contractName;
    this.contractAbi = smartContractAbi;
    this.db = datastore;
    this.chainId = chainId;

    this.stacksNetwork = GetStacksNetwork(this.chainId);
    this.address = getAddressFromPrivateKey(
      this.randomPrivKey.data,
      this.chainId === ChainID.Mainnet ? TransactionVersion.Mainnet : TransactionVersion.Testnet
    );
  }
  async start() {
    if (this.contractAbi.fungible_tokens.length > 0) {
      if (this.isCompliant(FT_FUNCTIONS)) {
        await this.handleFtContract();
      }
    }
    if (this.contractAbi.non_fungible_tokens.length > 0) {
      if (this.isCompliant(NFT_FUNCTIONS)) {
        await this.handleNftContract();
      }
    }
  }

  /**
   * fetch Fungible contract metadata
   */
  private async handleFtContract() {
    try {
      //make read-only call to contract
      const contractCallName = await this.makeReadOnlyContractCall('get-name', []);
      const contractCallUri = await this.makeReadOnlyContractCall('get-token-uri', []);
      const contractCallSymbol = await this.makeReadOnlyContractCall('get-symbol', []);
      const contractCallDecimals = await this.makeReadOnlyContractCall('get-decimals', []);

      //check parse clarity values
      const nameCV = this.checkAndParseString(contractCallName);
      const uriCV = this.checkAndParseOptionalString(contractCallUri);
      const symbolCV = this.checkAndParseString(contractCallSymbol);
      const decimalsCV = this.checkAndParseUintCV(contractCallDecimals);

      let metadata: FtTokenMetadata = { name: '', description: '', image: '' };
      //fetch metadata from the uri if possible
      if (uriCV) {
        metadata = await this.getMetadataFromUri<FtTokenMetadata>(uriCV.data);
      }
      const { name, description, image } = metadata;
      const fungibleTokenMetadata: DbFungibleTokenMetadata = {
        token_uri: uriCV ? uriCV.data : '',
        name: nameCV ? nameCV.data : name, // prefer the on-chain name
        description: description,
        image_uri: image ? this.getImageUrl(image) : '',
        image_canonical_uri: image || '',
        symbol: symbolCV ? symbolCV.data : '',
        decimals: decimalsCV ? Number(decimalsCV.value) : 0,
        contract_id: `${this.contractAddress}.${this.contractName}`,
      };

      //store metadata in db
      await this.storeFtMetadata(fungibleTokenMetadata);
    } catch (error) {
      logger.error('error handling FT contract', error);
      throw error;
    }
  }

  /**
   * fetch Non Fungible contract metadata
   */
  private async handleNftContract() {
    try {
      const contractCallTokenId = await this.makeReadOnlyContractCall('get-last-token-id', []);
      const tokenId = this.checkAndParseUintCV(contractCallTokenId);

      if (tokenId) {
        const contractCallUri = await this.makeReadOnlyContractCall('get-token-uri', [tokenId]);
        const uriCV = this.checkAndParseOptionalString(contractCallUri);

        let metadata: NftTokenMetadata = { name: '', description: '', imageUrl: '' };
        if (uriCV) {
          metadata = await this.getMetadataFromUri<NftTokenMetadata>(uriCV.data);
        }

        const nonFungibleTokenMetadata: DbNonFungibleTokenMetadata = {
          token_uri: uriCV ? uriCV.data : '',
          name: metadata.name,
          description: metadata.description,
          image_uri: metadata.imageUrl ? this.getImageUrl(metadata.imageUrl) : '',
          image_canonical_uri: metadata.imageUrl || '',
          contract_id: `${this.contractAddress}.${this.contractName}`,
        };
        await this.storeNftMetadata(nonFungibleTokenMetadata);
      }
    } catch (error) {
      logger.error('error: error handling NFT contract', error);
      throw error;
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

  private checkAndParseUintCV(responseCV: ClarityValue): UIntCV | undefined {
    if (responseCV.type === ClarityType.ResponseOk && responseCV.value.type === ClarityType.UInt) {
      return responseCV.value;
    }
    return;
  }

  private checkAndParseOptionalString(
    responseCV: ClarityValue
  ): StringUtf8CV | StringAsciiCV | undefined {
    if (
      responseCV.type === ClarityType.ResponseOk &&
      responseCV.value.type === ClarityType.OptionalSome &&
      (responseCV.value.value.type === ClarityType.StringASCII ||
        responseCV.value.value.type === ClarityType.StringUTF8)
    ) {
      return responseCV.value.value;
    }
  }

  private checkAndParseString(responseCV: ClarityValue): StringUtf8CV | StringAsciiCV | undefined {
    if (
      responseCV.type === ClarityType.ResponseOk &&
      (responseCV.value.type === ClarityType.StringASCII ||
        responseCV.value.type === ClarityType.StringUTF8)
    ) {
      return responseCV.value;
    }
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
      logError(`Error getting text`, error);
    }
    throw new Error(`Response ${result.status}: ${result.statusText} fetching ${url} - ${msg}`);
  }

  try {
    const resultString = await result.text();
    return JSON.parse(resultString) as Type;
  } catch (error) {
    logError(`Error reading response from ${url}`, error);
    throw error;
  }
}
