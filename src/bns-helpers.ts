import {
  deserializeCV,
  ClarityType,
  ClarityValue,
  BufferCV,
  StandardPrincipalCV,
  TupleCV,
  BufferReader,
  Address,
  IntCV,
  addressToString,
  StringAsciiCV,
  SomeCV,
  UIntCV,
  ListCV,
} from '@stacks/transactions';
import { DbBNSNamespace } from './datastore/common';
import { hexToBuffer } from './helpers';
import BN = require('bn.js');
import { CoreNodeParsedTxMessage } from './event-stream/core-node-message';
import { TransactionPayloadTypeID } from './p2p/tx';
import { StacksCoreRpcClient, getCoreNodeEndpoint } from './core-rpc/client';
import { StacksTestnet } from '@stacks/network';
import { URIType } from 'zone-file/dist/zoneFile';

export interface Attachment {
  attachment: {
    hash: string;
    metadata: {
      name: string;
      namespace: string;
      tx_sender: Address;
      op: string;
    };
  };
}

interface AttachmentValue {
  attachment: {
    content: number[];
  };
}

export function parseNameRawValue(rawValue: string): Attachment {
  const cl_val: ClarityValue = deserializeCV(hexToBuffer(rawValue));
  if (cl_val.type == ClarityType.Tuple) {
    const attachment = cl_val.data['attachment'] as TupleCV;

    const hash: BufferCV = attachment.data['hash'] as BufferCV;
    const contentHash = hash.buffer.toString('hex');

    const metadataCV: TupleCV = attachment.data['metadata'] as TupleCV;

    const nameCV: BufferCV = metadataCV.data['name'] as BufferCV;
    const name = nameCV.buffer.toString();
    const namespaceCV: BufferCV = metadataCV.data['namespace'] as BufferCV;
    const namespace = namespaceCV.buffer.toString();
    const opCV: StringAsciiCV = metadataCV.data['op'] as StringAsciiCV;
    const op = opCV.data;
    const addressCV: StandardPrincipalCV = metadataCV.data['tx-sender'] as StandardPrincipalCV;
    const address = addressCV.address;

    const result: Attachment = {
      attachment: {
        hash: contentHash,
        metadata: {
          name: name,
          namespace: namespace,
          tx_sender: address,
          op: op,
        },
      },
    };
    return result;
  }
  throw Error('Invalid clarity type');
}

export function parseNamespaceRawValue(
  rawValue: string,
  readyBlock: number,
  txid: string,
  indexBlockHash: string
): DbBNSNamespace | undefined {
  const cl_val: ClarityValue = deserializeCV(hexToBuffer(rawValue));
  if (cl_val.type == ClarityType.Tuple) {
    const namespaceCV: BufferCV = cl_val.data['namespace'] as BufferCV;
    const namespace = namespaceCV.buffer.toString();
    const statusCV: StringAsciiCV = cl_val.data['status'] as StringAsciiCV;
    const status = statusCV.data;

    const properties = cl_val.data['properties'] as TupleCV;

    const launched_atCV = properties.data['launched-at'] as SomeCV;
    const launch_atintCV = launched_atCV.value as UIntCV;
    const launched_at = parseInt(launch_atintCV.value.toString());
    const lifetimeCV = properties.data['lifetime'] as IntCV;
    const lifetime: BN = lifetimeCV.value;
    const revealed_atCV = properties.data['revealed-at'] as IntCV;
    const revealed_at: BN = revealed_atCV.value;
    const addressCV: StandardPrincipalCV = properties.data[
      'namespace-import'
    ] as StandardPrincipalCV;
    const address = addressCV.address;

    const price_function = properties.data['price-function'] as TupleCV;

    const baseCV = price_function.data['base'] as IntCV;
    const base: BN = baseCV.value;
    const coeffCV = price_function.data['coeff'] as IntCV;
    const coeff: BN = coeffCV.value;
    const no_vowel_discountCV = price_function.data['no-vowel-discount'] as IntCV;
    const no_vowel_discount: BN = no_vowel_discountCV.value;
    const nonalpha_discountCV = price_function.data['nonalpha-discount'] as IntCV;
    const nonalpha_discount: BN = nonalpha_discountCV.value;
    const bucketsCV = price_function.data['buckets'] as ListCV;

    const buckets: number[] = [];
    const listCV = bucketsCV.list;
    for (let i = 0; i < listCV.length; i++) {
      const cv = listCV[i];
      if (cv.type === ClarityType.UInt) {
        buckets.push(cv.value);
      }
    }

    const namespaceBNS: DbBNSNamespace = {
      namespace_id: namespace,
      address: addressToString(address),
      base: base.toNumber(),
      coeff: coeff.toNumber(),
      launched_at: launched_at,
      lifetime: lifetime.toNumber(),
      no_vowel_discount: no_vowel_discount.toNumber(),
      nonalpha_discount: nonalpha_discount.toNumber(),
      ready_block: readyBlock,
      reveal_block: revealed_at.toNumber(),
      status: status,
      latest: true,
      buckets: buckets.toString(),
      tx_id: txid,
      canonical: true,
      index_block_hash: indexBlockHash,
    };
    return namespaceBNS;
  }

  throw new Error('Invalid clarity type');
}

export async function fetchAttachmentContent(contentHash: string): Promise<string> {
  let result: AttachmentValue | undefined = undefined;
  try {
    result = await new StacksCoreRpcClient().fetchJson<AttachmentValue>(
      `v2/attachments/${contentHash}`,
      {
        method: 'GET',
        timeout: 10 * 1000, //10 seconds
      }
    );
  } catch (error) {
    throw Error('Error: can not get content hash');
  }

  const content = Buffer.from(result.attachment.content).toString('ascii');
  return content;
}

export function getFunctionName(tx_id: string, transactions: CoreNodeParsedTxMessage[]): string {
  const contract_function_name: string = '';
  for (const tx of transactions) {
    if (tx.core_tx.txid === tx_id) {
      if (tx.parsed_tx.payload.typeId === TransactionPayloadTypeID.ContractCall) {
        return tx.parsed_tx.payload.functionName;
      }
    }
  }
  return contract_function_name;
}

export function GetStacksTestnetNetwork() {
  const stacksNetwork = new StacksTestnet();
  stacksNetwork.coreApiUrl = `http://${getCoreNodeEndpoint()}`;
  return stacksNetwork;
}

export function parseTxt(txt: string[]) {
  const parsed: any = {
    owner: '',
    seqn: '',
    parts: '',
    zf0: '',
  };
  for (let i = 0; i < txt.length; i++) {
    const [key, value] = txt[i].split('=');
    if (key == undefined || value == undefined) continue;
    parsed[key] = value;
  }
  return parsed;
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

export interface ZoneFileTXT {
  owner: string;
  seqn: string;
  parts: string;
  zoneFile: string;
}

export function parseZoneFileTxt(txtEntries: string | string[]) {
  const txt = Array.isArray(txtEntries) ? txtEntries : [txtEntries];
  const parsed: ZoneFileTXT = {
    owner: '',
    seqn: '',
    parts: '',
    zoneFile: '',
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
  return parsed;
}
