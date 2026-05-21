import {
  PostConditionAssetInfoID,
  PostConditionModeID,
  PostConditionPrincipalTypeID,
} from '@stacks/codec';
import type {
  TxPostCondition,
  PostConditionPrincipal as CodecPostConditionPrincipal,
} from '@stacks/codec';
import {
  PostCondition,
  PostConditionMode,
  PostConditionPrincipal,
} from '../../schemas/v3/entities/post-conditions.js';

function serializePostConditionPrincipal(
  principal: CodecPostConditionPrincipal
): PostConditionPrincipal {
  if (principal.type_id === PostConditionPrincipalTypeID.Standard) {
    return {
      type_id: 'principal_standard',
      address: principal.address,
    };
  }
  if (principal.type_id === PostConditionPrincipalTypeID.Contract) {
    return {
      type_id: 'principal_contract',
      contract_name: principal.contract_name,
      address: principal.address,
    };
  }
  return {
    type_id: 'principal_origin',
  };
}

/**
 * Serializes a codec post condition into a post condition.
 * @param pc - The codec post condition to serialize.
 * @returns The serialized post condition.
 */
export function serializePostCondition(pc: TxPostCondition): PostCondition {
  switch (pc.asset_info_id) {
    case PostConditionAssetInfoID.STX:
      return {
        type: 'stx',
        condition_code: pc.condition_name,
        amount: pc.amount,
        principal: serializePostConditionPrincipal(pc.principal),
      };
    case PostConditionAssetInfoID.FungibleAsset:
      return {
        type: 'fungible',
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
        type: 'non_fungible',
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

export function serializePostConditionMode(mode: PostConditionModeID): PostConditionMode {
  switch (mode) {
    case PostConditionModeID.Allow:
      return 'allow';
    case PostConditionModeID.Deny:
      return 'deny';
    case PostConditionModeID.Originator:
      return 'originator';
  }
}
