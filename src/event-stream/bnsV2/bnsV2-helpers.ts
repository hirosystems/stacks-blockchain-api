import { BufferCV, ClarityType, hexToCV } from '@stacks/transactions';
import { bnsNameCV, ChainID, getChainIDNetwork } from '../../helpers';
import { CoreNodeEvent, CoreNodeEventType, CoreNodeParsedTxMessage } from '../core-node-message';
import { getCoreNodeEndpoint } from '../../core-rpc/client';
import { StacksMainnet, StacksTestnet } from '@stacks/network';
import { URIType } from 'zone-file/dist/zoneFile';
import { BnsV2ContractIdentifier, printTopic } from './bnsV2-constants';
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
  ClarityValueOptional,
  ClarityValueBool,
  ClarityValuePrincipalContract,
} from 'stacks-encoding-native-js';
import { SmartContractEvent } from '../core-node-message';
import { DbBnsNamespaceV2, DbBnsNameV2 } from '../../datastore/common';
import { hexToBuffer, hexToUtf8String } from '@hirosystems/api-toolkit';

export function GetStacksNetwork(chainId: ChainID) {
  const url = `http://${getCoreNodeEndpoint()}`;
  const network =
    getChainIDNetwork(chainId) === 'mainnet'
      ? new StacksMainnet({ url })
      : new StacksTestnet({ url });
  return network;
}

export function getBnsV2ContractID(chainId: ChainID) {
  const contractId =
    getChainIDNetwork(chainId) === 'mainnet'
      ? BnsV2ContractIdentifier.mainnet
      : BnsV2ContractIdentifier.testnet;
  return contractId;
}

function isEventFromBnsV2Contract(event: SmartContractEvent): boolean {
  return (
    event.committed === true &&
    event.contract_event.topic === printTopic &&
    (event.contract_event.contract_identifier === BnsV2ContractIdentifier.mainnet ||
      event.contract_event.contract_identifier === BnsV2ContractIdentifier.testnet)
  );
}

export function parseNameV2RawValue(
  rawValue: string,
  block: number,
  txid: string,
  txIndex: number
): DbBnsNameV2 {
  const cl_val = decodeClarityValue<
    ClarityValueTuple<{
      topic: ClarityValueStringAscii;
      owner: ClarityValuePrincipalStandard | ClarityValuePrincipalContract;
      name: ClarityValueTuple<{ name: ClarityValueBuffer; namespace: ClarityValueBuffer }>;
      id: ClarityValueUInt;
      properties: ClarityValueTuple<{
        'registered-at': ClarityValueOptionalUInt;
        'imported-at': ClarityValueOptionalUInt;
        'hashed-salted-fqn-preorder': ClarityValueOptional<ClarityValueBuffer>;
        'preordered-by': ClarityValueOptional<
          ClarityValuePrincipalStandard | ClarityValuePrincipalContract
        >;
        'renewal-height': ClarityValueUInt;
        'stx-burn': ClarityValueUInt;
        owner: ClarityValuePrincipalStandard | ClarityValuePrincipalContract;
      }>;
    }>
  >(rawValue);
  if (cl_val.type_id !== ClarityTypeID.Tuple) {
    throw Error('Invalid clarity type');
  }
  const properties = cl_val.data.properties;
  const nameCV = cl_val.data.name;

  const nameBuffer = nameCV.data.name.buffer;
  const namespaceBuffer = nameCV.data.namespace.buffer;

  const name = hexToUtf8String(nameBuffer);
  const namespace = hexToUtf8String(namespaceBuffer);

  const fullName = `${name}.${namespace}`;

  const registeredAtCV = properties.data['registered-at'];
  const registered_at =
    registeredAtCV.type_id === ClarityTypeID.OptionalSome
      ? Number(registeredAtCV.value.value)
      : undefined;
  const importedAtCV = properties.data['imported-at'];
  const imported_at =
    importedAtCV.type_id === ClarityTypeID.OptionalSome
      ? Number(importedAtCV.value.value)
      : undefined;
  const hashedSaltedFqnPreorderCV = properties.data['hashed-salted-fqn-preorder'];
  const hashed_salted_fqn_preorder =
    hashedSaltedFqnPreorderCV.type_id === ClarityTypeID.OptionalSome
      ? hashedSaltedFqnPreorderCV.value.buffer
      : undefined;
  const preorderedByCV = properties.data['preordered-by'];
  const preordered_by =
    preorderedByCV.type_id === ClarityTypeID.OptionalSome
      ? preorderedByCV.value.address
      : undefined;
  const renewalHeightCV = properties.data['renewal-height'];
  const renewal_height = Number(renewalHeightCV.value);
  const stxBurnCV = properties.data['stx-burn'];
  const stx_burn = Number(stxBurnCV.value);
  const ownerCV = properties.data.owner;
  const owner = ownerCV.address;

  const result: DbBnsNameV2 = {
    fullName: fullName,
    name: name,
    namespace_id: namespace,
    registered_at: registered_at,
    imported_at: imported_at,
    hashed_salted_fqn_preorder: hashed_salted_fqn_preorder,
    preordered_by: preordered_by,
    renewal_height: renewal_height,
    stx_burn: stx_burn,
    owner: owner,
    tx_id: txid,
    tx_index: txIndex,
    canonical: true,
  };

  return result;
}

export function parseNameV2FromContractEvent(
  event: SmartContractEvent,
  tx: CoreNodeParsedTxMessage,
  blockHeight: number
): DbBnsNameV2 | undefined {
  if (tx.core_tx.status !== 'success' || !isEventFromBnsV2Contract(event)) {
    return;
  }

  // Decode the raw Clarity value from the contract event.
  const decodedEvent = hexToCV(event.contract_event.raw_value);

  // Check if the decoded event is a tuple containing a 'topic' field.
  if (
    decodedEvent.type === ClarityType.Tuple &&
    decodedEvent.data.topic &&
    decodedEvent.data.topic.type === ClarityType.StringASCII
  ) {
    // Extract the topic value from the event.
    const topic = decodedEvent.data.topic.data;

    // Define the list of topics that we want to handle.
    const topicsToHandle = ['transfer-name', 'burn-name', 'new-name', 'renew-name'];

    // Check if the event's topic is one of the statuses we care about.
    if (topicsToHandle.includes(topic)) {
      // Parse the namespace data from the event.
      const name = parseNameV2RawValue(
        event.contract_event.raw_value,
        blockHeight,
        event.txid,
        tx.core_tx.tx_index
      );
      return name;
    }
  }
}

export function parseNamespaceV2RawValue(
  rawValue: string,
  launchBlock: number,
  txid: string,
  txIndex: number
): DbBnsNamespaceV2 | undefined {
  const cl_val = decodeClarityValue<
    ClarityValueTuple<{
      namespace: ClarityValueBuffer;
      status: ClarityValueStringAscii;
      properties: ClarityValueTuple<{
        'namespace-manager': ClarityValueOptional<
          ClarityValuePrincipalStandard | ClarityValuePrincipalContract
        >;
        'manager-transferable': ClarityValueBool;
        'manager-frozen': ClarityValueBool;
        'namespace-import': ClarityValuePrincipalStandard | ClarityValuePrincipalContract;
        'revealed-at': ClarityValueUInt;
        'launched-at': ClarityValueOptionalUInt;
        lifetime: ClarityValueUInt;
        'can-update-price-function': ClarityValueBool;
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

  const namespaceManagerCV = properties.data['namespace-manager'];
  const namespace_manager =
    namespaceManagerCV.type_id === ClarityTypeID.OptionalSome
      ? namespaceManagerCV.value.address
      : undefined;

  const managerTransferableCV = properties.data['manager-transferable'];
  const manager_transferable = managerTransferableCV.value;

  const managerFrozenCV = properties.data['manager-frozen'];
  const manager_frozen = managerFrozenCV.value;

  const namespaceImportCV = properties.data['namespace-import'];
  const namespace_import = namespaceImportCV.address;

  const revealed_atCV = properties.data['revealed-at'];
  const revealed_at = Number(revealed_atCV.value);

  const launched_atCV = properties.data['launched-at'];
  const launched_at =
    launched_atCV.type_id === ClarityTypeID.OptionalSome
      ? Number(launched_atCV.value.value)
      : undefined;

  const lifetimeCV = properties.data.lifetime;
  const lifetime = Number(lifetimeCV.value);

  const canUpdatePriceFunctionCV = properties.data['can-update-price-function'];
  const can_update_price_function = canUpdatePriceFunctionCV.value;

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

  const namespaceBnsV2: DbBnsNamespaceV2 = {
    namespace_id: namespace,
    namespace_manager: namespace_manager,
    manager_transferable: manager_transferable,
    manager_frozen: manager_frozen,
    namespace_import: namespace_import,
    reveal_block: revealed_at,
    launched_at: launched_at,
    launch_block: launchBlock,
    lifetime: lifetime,
    can_update_price_function: can_update_price_function,
    buckets: buckets.toString(),
    base: base,
    coeff: coeff,
    nonalpha_discount: nonalpha_discount,
    no_vowel_discount: no_vowel_discount,
    status: status,
    tx_id: txid,
    tx_index: txIndex,
    canonical: true,
  };
  return namespaceBnsV2;
}

export function parseNamespaceFromV2ContractEvent(
  event: SmartContractEvent,
  tx: CoreNodeParsedTxMessage,
  blockHeight: number
): DbBnsNamespaceV2 | undefined {
  // Ensure the transaction was successful and the event is from the BNS-V2 contract.
  if (tx.core_tx.status !== 'success' || !isEventFromBnsV2Contract(event)) {
    return;
  }

  // Decode the raw Clarity value from the contract event.
  const decodedEvent = hexToCV(event.contract_event.raw_value);

  // Check if the decoded event is a tuple containing a 'status' field.
  if (
    decodedEvent.type === ClarityType.Tuple &&
    decodedEvent.data.status &&
    decodedEvent.data.status.type === ClarityType.StringASCII
  ) {
    // Extract the status value from the event.
    const status = decodedEvent.data.status.data;

    // Define the list of statuses that we want to handle.
    const statusesToHandle = [
      'launch',
      'transfer-manager',
      'freeze-manager',
      'turn-off-manager-transfers',
      'update-price-manager',
      'freeze-price-manager',
    ];

    // Check if the event's status is one of the statuses we care about.
    if (statusesToHandle.includes(status)) {
      // Parse the namespace data from the event.
      const namespace = parseNamespaceV2RawValue(
        event.contract_event.raw_value,
        blockHeight,
        event.txid,
        tx.core_tx.tx_index
      );
      return namespace;
    }
  }
}

// export function parseNameRenewalWithNoZonefileHashFromContractCall(
//   tx: CoreNodeParsedTxMessage,
//   chainId: ChainID
// ): DbBnsName | undefined {
//   const payload = tx.parsed_tx.payload;
//   if (
//     tx.core_tx.status === 'success' &&
//     payload.type_id === TxPayloadTypeID.ContractCall &&
//     payload.function_name === 'name-renewal' &&
//     getBnsV2ContractID(chainId) === `${payload.address}.${payload.contract_name}` &&
//     payload.function_args.length === 5 &&
//     hexToCV(payload.function_args[4].hex).type === ClarityType.OptionalNone
//   ) {
//     const namespace = Buffer.from(
//       (hexToCV(payload.function_args[0].hex) as BufferCV).buffer
//     ).toString('utf8');
//     const name = Buffer.from((hexToCV(payload.function_args[1].hex) as BufferCV).buffer).toString(
//       'utf8'
//     );
//     return {
//       name: `${name}.${namespace}`,
//       namespace_id: namespace,
//       // NOTE: We're not using the `new_owner` argument here because there's a bug in the BNS
//       // contract that doesn't actually transfer the name to the given principal:
//       // https://github.com/stacks-network/stacks-blockchain/issues/2680, maybe this will be fixed
//       // in Stacks 2.1
//       address: tx.sender_address,
//       // expire_block will be calculated upon DB insert based on the namespace's lifetime.
//       expire_block: 0,
//       registered_at: tx.block_height,
//       // Since we received no zonefile_hash, the previous one will be reused when writing to DB.
//       zonefile_hash: '',
//       zonefile: '',
//       tx_id: tx.parsed_tx.tx_id,
//       tx_index: tx.core_tx.tx_index,
//       event_index: undefined,
//       status: 'name-renewal',
//       canonical: true,
//     };
//   }
// }

// export function parseResolver(uri: URIType[]) {
//   let resolver = '';
//   uri.forEach(item => {
//     if (item.name?.includes('resolver')) {
//       resolver = item.target;
//     }
//   });
//   return resolver;
// }

// interface ZoneFileTXT {
//   owner: string;
//   seqn: string;
//   parts: string;
//   zoneFile: string;
//   zoneFileHash: string;
// }

// export function parseZoneFileTxt(txtEntries: string | string[]) {
//   const txt = Array.isArray(txtEntries) ? txtEntries : [txtEntries];
//   const parsed: ZoneFileTXT = {
//     owner: '',
//     seqn: '',
//     parts: '',
//     zoneFile: '',
//     zoneFileHash: '',
//   };

//   let zoneFile = '';
//   for (let i = 0; i < txt.length; i++) {
//     const [key, value] = txt[i].split('=');
//     if (key == 'owner') {
//       parsed.owner = value;
//     } else if (key == 'seqn') {
//       parsed.seqn = value;
//     } else if (key == 'parts') {
//       parsed.parts = value;
//     } else if (key.startsWith('zf')) {
//       zoneFile += value;
//     }
//   }
//   parsed.zoneFile = Buffer.from(zoneFile, 'base64').toString('ascii');
//   parsed.zoneFileHash = crypto
//     .createHash('sha256')
//     .update(Buffer.from(zoneFile, 'base64'))
//     .digest()
//     .slice(16)
//     .toString('hex');
//   return parsed;
// }
