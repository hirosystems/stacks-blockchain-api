import { Address, ChainID, StacksMessageType } from '@stacks/transactions';
import { DbBnsNamespace } from './datastore/common';
import { hexToBuffer, hexToUtf8String } from './helpers';
import { CoreNodeParsedTxMessage } from './event-stream/core-node-message';
import { StacksCoreRpcClient, getCoreNodeEndpoint } from './core-rpc/client';
import { StacksMainnet, StacksTestnet } from '@stacks/network';
import { URIType } from 'zone-file/dist/zoneFile';
import { BnsContractIdentifier } from './bns-constants';
import * as crypto from 'crypto';
import {
  ClarityTypeID,
  decodeClarityValue,
  ClarityValue,
  ClarityValueBuffer,
  ClarityValueInt,
  ClarityValueList,
  ClarityValueOptional,
  ClarityValueOptionalSome,
  ClarityValueOptionalUInt,
  ClarityValuePrincipalStandard,
  ClarityValueStringAscii,
  ClarityValueTuple,
  ClarityValueUInt,
  TxPayloadTypeID,
  ClarityValuePrincipalContract,
} from 'stacks-encoding-native-js';

interface Attachment {
  attachment: {
    hash: string;
    metadata: {
      name: string;
      namespace: string;
      tx_sender: {
        address: string;
        version: number;
        hash160: string;
      };
      op: string;
    };
  };
}

export function parseNameRawValue(rawValue: string): Attachment {
  const cl_val = decodeClarityValue<
    ClarityValueTuple<{
      attachment: ClarityValueTuple<{
        hash: ClarityValueBuffer;
        metadata: ClarityValueTuple<{
          name: ClarityValueBuffer;
          namespace: ClarityValueBuffer;
          op: ClarityValueStringAscii;
          'tx-sender': ClarityValuePrincipalStandard;
        }>;
      }>;
    }>
  >(rawValue);
  if (cl_val.type_id !== ClarityTypeID.Tuple) {
    throw Error('Invalid clarity type');
  }
  const attachment = cl_val.data.attachment;

  const hash = attachment.data.hash;
  const contentHash = hexToBuffer(hash.buffer).toString('hex');

  const metadataCV = attachment.data.metadata;

  const nameCV = metadataCV.data.name;
  const name = hexToUtf8String(nameCV.buffer);
  const namespaceCV = metadataCV.data.namespace;
  const namespace = hexToUtf8String(namespaceCV.buffer);
  const opCV = metadataCV.data.op;
  const op = opCV.data;
  const addressCV = metadataCV.data['tx-sender'];

  const result: Attachment = {
    attachment: {
      hash: contentHash,
      metadata: {
        name: name,
        namespace: namespace,
        tx_sender: {
          address: addressCV.address,
          version: addressCV.address_version,
          hash160: hexToBuffer(addressCV.address_hash_bytes).toString('hex'),
        },
        op: op,
      },
    },
  };
  return result;
}

export function parseNamespaceRawValue(
  rawValue: string,
  readyBlock: number,
  txid: string,
  txIndex: number
): DbBnsNamespace | undefined {
  const cl_val = decodeClarityValue<
    ClarityValueTuple<{
      namespace: ClarityValueBuffer;
      status: ClarityValueStringAscii;
      properties: ClarityValueTuple<{
        'launched-at': ClarityValueOptionalUInt;
        lifetime: ClarityValueUInt;
        'revealed-at': ClarityValueUInt;
        'namespace-import': ClarityValuePrincipalStandard;
        'price-function': ClarityValueTuple<{
          base: ClarityValueUInt;
          coeff: ClarityValueUInt;
          'no-vowel-discount': ClarityValueUInt;
          'nonalpha-discount': ClarityValueUInt;
          buckets: ClarityValueList<ClarityValueUInt>;
        }>;
      }>;
    }>
  >(rawValue);
  if (cl_val.type_id !== ClarityTypeID.Tuple) {
    throw new Error('Invalid clarity type');
  }

  const namespaceCV = cl_val.data.namespace;
  const namespace = hexToUtf8String(namespaceCV.buffer);
  const statusCV = cl_val.data.status;
  const status = statusCV.data;
  const properties = cl_val.data.properties;

  const launched_atCV = properties.data['launched-at'];
  const launched_at =
    launched_atCV.type_id === ClarityTypeID.OptionalSome ? parseInt(launched_atCV.value.value) : 0;
  const lifetimeCV = properties.data.lifetime;
  const lifetime = BigInt(lifetimeCV.value);
  const revealed_atCV = properties.data['revealed-at'];
  const revealed_at = BigInt(revealed_atCV.value);
  const addressCV = properties.data['namespace-import'];
  const address = addressCV.address;

  const price_function = properties.data['price-function'];

  const baseCV = price_function.data.base;
  const base = BigInt(baseCV.value);
  const coeffCV = price_function.data.coeff;
  const coeff = BigInt(coeffCV.value);
  const no_vowel_discountCV = price_function.data['no-vowel-discount'];
  const no_vowel_discount = BigInt(no_vowel_discountCV.value);
  const nonalpha_discountCV = price_function.data['nonalpha-discount'];
  const nonalpha_discount = BigInt(nonalpha_discountCV.value);
  const bucketsCV = price_function.data.buckets;

  const buckets: bigint[] = [];
  const listCV = bucketsCV.list;
  for (let i = 0; i < listCV.length; i++) {
    const cv = listCV[i];
    if (cv.type_id === ClarityTypeID.UInt) {
      buckets.push(BigInt(cv.value));
    }
  }

  const namespaceBns: DbBnsNamespace = {
    namespace_id: namespace,
    address: address,
    base: Number(base),
    coeff: Number(coeff),
    launched_at: launched_at,
    lifetime: Number(lifetime),
    no_vowel_discount: Number(no_vowel_discount),
    nonalpha_discount: Number(nonalpha_discount),
    ready_block: readyBlock,
    reveal_block: Number(revealed_at),
    status: status,
    buckets: buckets.toString(),
    tx_id: txid,
    tx_index: txIndex,
    canonical: true,
  };
  return namespaceBns;
}

export function getFunctionName(tx_id: string, transactions: CoreNodeParsedTxMessage[]): string {
  const contract_function_name: string = '';
  for (const tx of transactions) {
    if (tx.core_tx.txid === tx_id) {
      if (tx.parsed_tx.payload.type_id === TxPayloadTypeID.ContractCall) {
        return tx.parsed_tx.payload.function_name;
      }
    }
  }
  return contract_function_name;
}

export function getNewOwner(
  tx_id: string,
  transactions: CoreNodeParsedTxMessage[]
): string | undefined {
  for (const tx of transactions) {
    if (tx.core_tx.txid === tx_id) {
      if (tx.parsed_tx.payload.type_id === TxPayloadTypeID.ContractCall) {
        if (
          tx.parsed_tx.payload.function_args.length >= 3 &&
          tx.parsed_tx.payload.function_args[2].type_id === ClarityTypeID.PrincipalStandard
        ) {
          const decoded = decodeClarityValue(tx.parsed_tx.payload.function_args[2].hex);
          const principal = decoded as ClarityValuePrincipalStandard;
          principal.address;
        }
      }
    }
  }
  return undefined;
}

export function GetStacksNetwork(chainId: ChainID) {
  const network = chainId === ChainID.Mainnet ? new StacksMainnet() : new StacksTestnet();
  network.coreApiUrl = `http://${getCoreNodeEndpoint()}`;
  return network;
}

export function parseResolver(uri: URIType[]) {
  let resolver = '';
  uri.forEach(item => {
    if (item.name?.includes('resolver')) {
      resolver = item.target;
    }
  });
  return resolver;
}

interface ZoneFileTXT {
  owner: string;
  seqn: string;
  parts: string;
  zoneFile: string;
  zoneFileHash: string;
}

export function parseZoneFileTxt(txtEntries: string | string[]) {
  const txt = Array.isArray(txtEntries) ? txtEntries : [txtEntries];
  const parsed: ZoneFileTXT = {
    owner: '',
    seqn: '',
    parts: '',
    zoneFile: '',
    zoneFileHash: '',
  };

  let zoneFile = '';
  for (let i = 0; i < txt.length; i++) {
    const [key, value] = txt[i].split('=');
    if (key == 'owner') {
      parsed.owner = value;
    } else if (key == 'seqn') {
      parsed.seqn = value;
    } else if (key == 'parts') {
      parsed.parts = value;
    } else if (key.startsWith('zf')) {
      zoneFile += value;
    }
  }
  parsed.zoneFile = Buffer.from(zoneFile, 'base64').toString('ascii');
  parsed.zoneFileHash = crypto
    .createHash('sha256')
    .update(Buffer.from(zoneFile, 'base64'))
    .digest()
    .slice(16)
    .toString('hex');
  return parsed;
}

export function getBnsContractID(chainId: ChainID) {
  const contractId =
    chainId === ChainID.Mainnet ? BnsContractIdentifier.mainnet : BnsContractIdentifier.testnet;
  return contractId;
}
