import {
  TxPostCondition,
  PostConditionAssetInfoID,
  PostConditionPrincipal,
  PostConditionPrincipalTypeID,
} from '@hirosystems/stacks-encoding-native-js';

const assetPrincipalTypeMap = {
  [PostConditionPrincipalTypeID.Origin]: 'principal_origin',
  [PostConditionPrincipalTypeID.Standard]: 'principal_standard',
  [PostConditionPrincipalTypeID.Contract]: 'principal_contract',
} as const;

function serializePostConditionPrincipal(principal: PostConditionPrincipal) {
  if (principal.type_id === PostConditionPrincipalTypeID.Standard) {
    return {
      type_id: assetPrincipalTypeMap[principal.type_id],
      address: principal.address,
    };
  }
  if (principal.type_id === PostConditionPrincipalTypeID.Contract) {
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
  [PostConditionAssetInfoID.STX]: 'stx',
  [PostConditionAssetInfoID.FungibleAsset]: 'fungible',
  [PostConditionAssetInfoID.NonfungibleAsset]: 'non_fungible',
} as const;

export function serializePostCondition(pc: TxPostCondition) {
  switch (pc.asset_info_id) {
    case PostConditionAssetInfoID.STX:
      return {
        type: assetInfoTypeMap[pc.asset_info_id],
        condition_code: pc.condition_name,
        amount: pc.amount,
        principal: serializePostConditionPrincipal(pc.principal),
      };
    case PostConditionAssetInfoID.FungibleAsset:
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
    case PostConditionAssetInfoID.NonfungibleAsset:
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

export function serializePostConditionMode(byte: number) {
  switch (byte) {
    case 1:
      return 'allow';
    case 2:
      return 'deny';
  }
  throw new Error(`PostConditionMode byte must be either 1 or 2 but was ${byte}`);
}
