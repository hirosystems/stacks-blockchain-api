import { BufferCV, ChainID, ClarityType, hexToCV, StringAsciiCV } from '@stacks/transactions';
import { bnsNameCV, hexToBuffer, hexToUtf8String } from '../../helpers';
import {
  CoreNodeEvent,
  CoreNodeEventType,
  CoreNodeParsedTxMessage,
  NftTransferEvent,
} from '../../event-stream/core-node-message';
import { getCoreNodeEndpoint } from '../../core-rpc/client';
import { StacksMainnet, StacksTestnet } from '@stacks/network';
import { URIType } from 'zone-file/dist/zoneFile';
import { BnsContractIdentifier, printTopic } from './bns-constants';
import * as crypto from 'crypto';
import {
  ClarityTypeID,
  decodeClarityValue,
  ClarityValueBuffer,
  ClarityValueList,
  ClarityValueOptionalUInt,
  ClarityValuePrincipalStandard,
  ClarityValueStringAscii,
  ClarityValueTuple,
  ClarityValueUInt,
  TxPayloadTypeID,
} from 'stacks-encoding-native-js';
import { SmartContractEvent } from '../core-node-message';
import { DbBnsNamespace, DbBnsName } from '../../datastore/common';

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
    base: base,
    coeff: coeff,
    launched_at: launched_at,
    lifetime: Number(lifetime),
    no_vowel_discount: no_vowel_discount,
    nonalpha_discount: nonalpha_discount,
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

export function GetStacksNetwork(chainId: ChainID) {
  const url = `http://${getCoreNodeEndpoint()}`;
  const network =
    chainId === ChainID.Mainnet ? new StacksMainnet({ url }) : new StacksTestnet({ url });
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

function isEventFromBnsContract(event: SmartContractEvent): boolean {
  return (
    event.committed === true &&
    event.contract_event.topic === printTopic &&
    (event.contract_event.contract_identifier === BnsContractIdentifier.mainnet ||
      event.contract_event.contract_identifier === BnsContractIdentifier.testnet)
  );
}

export function parseNameRenewalWithNoZonefileHashFromContractCall(
  tx: CoreNodeParsedTxMessage,
  chainId: ChainID
): DbBnsName | undefined {
  const payload = tx.parsed_tx.payload;
  if (
    tx.core_tx.status === 'success' &&
    payload.type_id === TxPayloadTypeID.ContractCall &&
    payload.function_name === 'name-renewal' &&
    getBnsContractID(chainId) === `${payload.address}.${payload.contract_name}` &&
    payload.function_args.length === 5 &&
    hexToCV(payload.function_args[4].hex).type === ClarityType.OptionalNone
  ) {
    const namespace = Buffer.from(
      (hexToCV(payload.function_args[0].hex) as BufferCV).buffer
    ).toString('utf8');
    const name = Buffer.from((hexToCV(payload.function_args[1].hex) as BufferCV).buffer).toString(
      'utf8'
    );
    return {
      name: `${name}.${namespace}`,
      namespace_id: namespace,
      // NOTE: We're not using the `new_owner` argument here because there's a bug in the BNS
      // contract that doesn't actually transfer the name to the given principal:
      // https://github.com/stacks-network/stacks-blockchain/issues/2680, maybe this will be fixed
      // in Stacks 2.1
      address: tx.sender_address,
      // expire_block will be calculated upon DB insert based on the namespace's lifetime.
      expire_block: 0,
      registered_at: tx.block_height,
      // Since we received no zonefile_hash, the previous one will be reused when writing to DB.
      zonefile_hash: '',
      zonefile: '',
      tx_id: tx.parsed_tx.tx_id,
      tx_index: tx.core_tx.tx_index,
      event_index: undefined,
      status: 'name-renewal',
      canonical: true,
    };
  }
}

export function parseNameFromContractEvent(
  event: SmartContractEvent,
  tx: CoreNodeParsedTxMessage,
  allEvents: CoreNodeEvent[],
  blockHeight: number,
  chainId: ChainID
): DbBnsName | undefined {
  if (tx.core_tx.status !== 'success' || !isEventFromBnsContract(event)) {
    return;
  }
  let attachment: Attachment;
  try {
    attachment = parseNameRawValue(event.contract_event.raw_value);
  } catch (error) {
    return;
  }
  const fullName = `${attachment.attachment.metadata.name}.${attachment.attachment.metadata.namespace}`;
  let ownerAddress = attachment.attachment.metadata.tx_sender.address;
  // Is this a `name-transfer`? If so, look for the new owner in an `nft_transfer` event bundled in
  // the same transaction.
  if (attachment.attachment.metadata.op === 'name-transfer') {
    for (const eventItem of allEvents) {
      if (
        eventItem.txid === event.txid &&
        eventItem.type === CoreNodeEventType.NftTransferEvent &&
        eventItem.nft_transfer_event.asset_identifier === `${getBnsContractID(chainId)}::names` &&
        eventItem.nft_transfer_event.raw_value === bnsNameCV(fullName)
      ) {
        ownerAddress = eventItem.nft_transfer_event.recipient;
        break;
      }
    }
  }
  const name: DbBnsName = {
    name: fullName,
    namespace_id: attachment.attachment.metadata.namespace,
    address: ownerAddress,
    // expire_block will be calculated upon DB insert based on the namespace's lifetime.
    expire_block: 0,
    registered_at: blockHeight,
    zonefile_hash: attachment.attachment.hash,
    // zonefile will be updated when an `/attachments/new` message arrives.
    zonefile: '',
    tx_id: event.txid,
    tx_index: tx.core_tx.tx_index,
    event_index: event.event_index,
    status: attachment.attachment.metadata.op,
    canonical: true,
  };
  return name;
}

export function parseNamespaceFromContractEvent(
  event: SmartContractEvent,
  tx: CoreNodeParsedTxMessage,
  blockHeight: number
): DbBnsNamespace | undefined {
  if (tx.core_tx.status !== 'success' || !isEventFromBnsContract(event)) {
    return;
  }
  // Look for a `namespace-ready` BNS print event.
  const decodedEvent = hexToCV(event.contract_event.raw_value);
  if (
    decodedEvent.type === ClarityType.Tuple &&
    decodedEvent.data.status &&
    decodedEvent.data.status.type === ClarityType.StringASCII &&
    decodedEvent.data.status.data === 'ready'
  ) {
    const namespace = parseNamespaceRawValue(
      event.contract_event.raw_value,
      blockHeight,
      event.txid,
      tx.core_tx.tx_index
    );
    return namespace;
  }
}
