import { c32address } from 'c32check';
import {
  PostCondition,
  PostConditionFungible,
  PostConditionNonFungible,
  PostConditionPrincipal,
  PostConditionFungibleConditionCode,
  PostConditionNonFungibleConditionCode,
} from '@entities';

import {
  TransactionPostCondition,
  AssetInfoTypeID,
  PostConditionPrincipal as TxPostConditionPrincipal,
  PostConditionPrincipalTypeID,
  AssetInfo,
  FungibleConditionCode,
  NonfungibleConditionCode,
} from '../../p2p/tx';

export function serializePostConditionPrincipal(
  principal: TxPostConditionPrincipal
): PostConditionPrincipal {
  if (
    principal.typeId === PostConditionPrincipalTypeID.Standard ||
    principal.typeId === PostConditionPrincipalTypeID.Contract
  ) {
    return {
      ...principal,
      address: c32address(principal.address.version, principal.address.bytes.toString('hex')),
    };
  }
  return principal;
}

type SerializedPostConditionAsset =
  | PostConditionFungible['asset']
  | PostConditionNonFungible['asset'];

export function serializePostConditionAsset(asset: AssetInfo): SerializedPostConditionAsset {
  return {
    ...asset,
    contractAddress: c32address(
      asset.contractAddress.version,
      asset.contractAddress.bytes.toString('hex')
    ),
  };
}

export function serializePostCondition(pc: TransactionPostCondition): PostCondition {
  switch (pc.assetInfoId) {
    case AssetInfoTypeID.STX:
      return {
        ...pc,
        conditionCode: serializeFungibleConditionCode(pc.conditionCode),
        amount: pc.amount.toString(),
        principal: serializePostConditionPrincipal(pc.principal),
      };
    case AssetInfoTypeID.FungibleAsset:
      return {
        ...pc,
        conditionCode: serializeFungibleConditionCode(pc.conditionCode),
        amount: pc.amount.toString(),
        principal: serializePostConditionPrincipal(pc.principal),
        asset: serializePostConditionAsset(pc.asset),
      };
    case AssetInfoTypeID.NonfungibleAsset:
      return {
        ...pc,
        conditionCode: serializeNonFungibleConditionCode(pc.conditionCode),
        principal: serializePostConditionPrincipal(pc.principal),
        assetValue: pc.assetValue.type.toString(),
        asset: serializePostConditionAsset(pc.asset),
      };
  }
}

const fungibleConditionCodeMap = {
  [FungibleConditionCode.SentEq]: 'sent_equal_to',
  [FungibleConditionCode.SentGe]: 'sent_greater_than',
  [FungibleConditionCode.SentGt]: 'sent_greater_than_or_equal_to',
  [FungibleConditionCode.SentLe]: 'sent_less_than',
  [FungibleConditionCode.SentLt]: 'sent_less_than_or_equal_to',
} as const;

export function serializeFungibleConditionCode(
  code: FungibleConditionCode
): PostConditionFungibleConditionCode {
  return fungibleConditionCodeMap[code];
}

const fungibleNonConditionCodeMap = {
  [NonfungibleConditionCode.NotSent]: 'not_sent',
  [NonfungibleConditionCode.Sent]: 'sent',
} as const;

export function serializeNonFungibleConditionCode(
  code: NonfungibleConditionCode
): PostConditionNonFungibleConditionCode {
  return fungibleNonConditionCodeMap[code];
}
