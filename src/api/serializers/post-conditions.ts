import codec from '@stacks/codec';
import type { TxPostCondition, PostConditionPrincipal } from '@stacks/codec';

const assetPrincipalTypeMap = {
  [codec.PostConditionPrincipalTypeID.Origin]: 'principal_origin',
  [codec.PostConditionPrincipalTypeID.Standard]: 'principal_standard',
  [codec.PostConditionPrincipalTypeID.Contract]: 'principal_contract',
} as const;

function serializePostConditionPrincipal(principal: PostConditionPrincipal) {
  if (principal.type_id === codec.PostConditionPrincipalTypeID.Standard) {
    return {
      type_id: assetPrincipalTypeMap[principal.type_id],
      address: principal.address,
    };
  }
  if (principal.type_id === codec.PostConditionPrincipalTypeID.Contract) {
    return {
      type_id: assetPrincipalTypeMap[principal.type_id],
      contract_name: principal.contract_name,
      address: principal.address,
    };
  }
  return {
    type_id: assetPrincipalTypeMap[principal.type_id],
  };
}

const assetInfoTypeMap = {
  [codec.PostConditionAssetInfoID.STX]: 'stx',
  [codec.PostConditionAssetInfoID.FungibleAsset]: 'fungible',
  [codec.PostConditionAssetInfoID.NonfungibleAsset]: 'non_fungible',
} as const;

export function serializePostCondition(pc: TxPostCondition) {
  switch (pc.asset_info_id) {
    case codec.PostConditionAssetInfoID.STX:
      return {
        type: assetInfoTypeMap[pc.asset_info_id],
        condition_code: pc.condition_name,
        amount: pc.amount,
        principal: serializePostConditionPrincipal(pc.principal),
      };
    case codec.PostConditionAssetInfoID.FungibleAsset:
      return {
        type: assetInfoTypeMap[pc.asset_info_id],
        condition_code: pc.condition_name,
        amount: pc.amount,
        principal: serializePostConditionPrincipal(pc.principal),
        asset: {
          contract_name: pc.asset.contract_name,
          asset_name: pc.asset.asset_name,
          contract_address: pc.asset.contract_address,
        },
      };
    case codec.PostConditionAssetInfoID.NonfungibleAsset:
      return {
        type: assetInfoTypeMap[pc.asset_info_id],
        condition_code: pc.condition_name,
        principal: serializePostConditionPrincipal(pc.principal),
        asset: {
          contract_name: pc.asset.contract_name,
          asset_name: pc.asset.asset_name,
          contract_address: pc.asset.contract_address,
        },
        asset_value: {
          hex: pc.asset_value.hex,
          repr: pc.asset_value.repr,
        },
      };
  }
}

export function serializePostConditionMode(mode: codec.PostConditionModeID) {
  switch (mode) {
    case codec.PostConditionModeID.Allow:
      return 'allow';
    case codec.PostConditionModeID.Deny:
      return 'deny';
    case codec.PostConditionModeID.Originator:
      return 'originator';
  }
}
