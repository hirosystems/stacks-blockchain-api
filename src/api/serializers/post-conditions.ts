import { c32address } from 'c32check';
import { serializeCV, cvToString } from '@stacks/transactions';

import {
  PostCondition,
  PostConditionFungible,
  PostConditionNonFungible,
  PostConditionPrincipal,
  PostConditionFungibleConditionCode,
  PostConditionNonFungibleConditionCode,
  PostConditionPrincipalType,
  PostConditionMode,
} from '@stacks/stacks-blockchain-api-types';

import {
  TransactionPostCondition,
  AssetInfoTypeID,
  PostConditionPrincipal as TxPostConditionPrincipal,
  PostConditionPrincipalTypeID,
  AssetInfo,
  FungibleConditionCode,
  NonfungibleConditionCode,
} from '../../p2p/tx';
import { bufferToHexPrefixString } from '../../helpers';

const assetPrincipalTypeMap = {
  [PostConditionPrincipalTypeID.Origin]: 'principal_origin',
  [PostConditionPrincipalTypeID.Standard]: 'principal_standard',
  [PostConditionPrincipalTypeID.Contract]: 'principal_contract',
} as const;

function serializePostConditionPrincipal(
  principal: TxPostConditionPrincipal
): PostConditionPrincipal {
  if (principal.typeId === PostConditionPrincipalTypeID.Standard) {
    return {
      type_id: assetPrincipalTypeMap[principal.typeId],
      address: c32address(principal.address.version, principal.address.bytes.toString('hex')),
    };
  }
  if (principal.typeId === PostConditionPrincipalTypeID.Contract) {
    return {
      type_id: assetPrincipalTypeMap[principal.typeId],
      contract_name: principal.contractName,
      address: c32address(principal.address.version, principal.address.bytes.toString('hex')),
    };
  }
  return {
    type_id: assetPrincipalTypeMap[principal.typeId],
  };
}

type SerializedPostConditionAsset =
  | PostConditionFungible['asset']
  | PostConditionNonFungible['asset'];

function serializePostConditionAsset(asset: AssetInfo): SerializedPostConditionAsset {
  return {
    contract_name: asset.contractName,
    asset_name: asset.assetName,
    contract_address: c32address(
      asset.contractAddress.version,
      asset.contractAddress.bytes.toString('hex')
    ),
  };
}

const assetInfoTypeMap = {
  [AssetInfoTypeID.STX]: 'stx',
  [AssetInfoTypeID.FungibleAsset]: 'fungible',
  [AssetInfoTypeID.NonfungibleAsset]: 'non_fungible',
} as const;

export function serializePostCondition(pc: TransactionPostCondition): PostCondition {
  switch (pc.assetInfoId) {
    case AssetInfoTypeID.STX:
      return {
        type: assetInfoTypeMap[pc.assetInfoId],
        condition_code: serializeFungibleConditionCode(pc.conditionCode),
        amount: pc.amount.toString(),
        principal: serializePostConditionPrincipal(pc.principal),
      };
    case AssetInfoTypeID.FungibleAsset:
      return {
        type: assetInfoTypeMap[pc.assetInfoId],
        condition_code: serializeFungibleConditionCode(pc.conditionCode),
        amount: pc.amount.toString(),
        principal: serializePostConditionPrincipal(pc.principal),
        asset: serializePostConditionAsset(pc.asset),
      };
    case AssetInfoTypeID.NonfungibleAsset:
      return {
        type: assetInfoTypeMap[pc.assetInfoId],
        condition_code: serializeNonFungibleConditionCode(pc.conditionCode),
        principal: serializePostConditionPrincipal(pc.principal),
        asset: serializePostConditionAsset(pc.asset),
        asset_value: {
          hex: bufferToHexPrefixString(serializeCV(pc.assetValue)),
          repr: cvToString(pc.assetValue),
        },
      };
  }
}

const fungibleConditionCodeMap = {
  [FungibleConditionCode.SentEq]: 'sent_equal_to',
  [FungibleConditionCode.SentGt]: 'sent_greater_than',
  [FungibleConditionCode.SentGe]: 'sent_greater_than_or_equal_to',
  [FungibleConditionCode.SentLt]: 'sent_less_than',
  [FungibleConditionCode.SentLe]: 'sent_less_than_or_equal_to',
} as const;

function serializeFungibleConditionCode(
  code: FungibleConditionCode
): PostConditionFungibleConditionCode {
  return fungibleConditionCodeMap[code];
}

const fungibleNonConditionCodeMap = {
  [NonfungibleConditionCode.NotSent]: 'not_sent',
  [NonfungibleConditionCode.Sent]: 'sent',
} as const;

function serializeNonFungibleConditionCode(
  code: NonfungibleConditionCode
): PostConditionNonFungibleConditionCode {
  return fungibleNonConditionCodeMap[code];
}

export function serializePostConditionMode(byte: number): PostConditionMode {
  if (byte === 1) {
    return 'allow';
  }
  if (byte === 2) {
    return 'deny';
  }
  throw new Error(`PostConditionMode byte must be either 1 or 2 but was ${byte}`);
}
