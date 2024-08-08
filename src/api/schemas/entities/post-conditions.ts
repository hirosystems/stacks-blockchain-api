import { Static, Type } from '@sinclair/typebox';

export const PostConditionModeSchema = Type.Union([Type.Literal('allow'), Type.Literal('deny')]);

const PostConditionPrincipalSchema = Type.Union([
  Type.Object({
    type_id: Type.Literal('principal_origin'),
  }),
  Type.Object({
    type_id: Type.Literal('principal_standard'),
    address: Type.String(),
  }),
  Type.Object({
    type_id: Type.Literal('principal_contract'),
    address: Type.String(),
    contract_name: Type.String(),
  }),
]);

const PostConditionFungibleConditionCodeSchema = Type.Union([
  Type.Literal('sent_equal_to'),
  Type.Literal('sent_greater_than'),
  Type.Literal('sent_greater_than_or_equal_to'),
  Type.Literal('sent_less_than'),
  Type.Literal('sent_less_than_or_equal_to'),
]);

const PostConditionStxSchema = Type.Object({
  principal: PostConditionPrincipalSchema,
  condition_code: PostConditionFungibleConditionCodeSchema,
  amount: Type.String(),
  type: Type.Literal('stx'),
});

const PostConditionFungibleAssetSchema = Type.Object({
  principal: PostConditionPrincipalSchema,
  condition_code: PostConditionFungibleConditionCodeSchema,
  amount: Type.String(),
  type: Type.Literal('fungible'),
  asset: Type.Object({
    asset_name: Type.String(),
    contract_address: Type.String(),
    contract_name: Type.String(),
  }),
});

const PostConditionNonFungibleAssetSchema = Type.Object({
  principal: PostConditionPrincipalSchema,
  condition_code: Type.Union([Type.Literal('sent'), Type.Literal('not_sent')]),
  type: Type.Literal('non_fungible'),
  asset_value: Type.Object({
    hex: Type.String(),
    repr: Type.String(),
  }),
  asset: Type.Object({
    asset_name: Type.String(),
    contract_address: Type.String(),
    contract_name: Type.String(),
  }),
});

export const PostConditionSchema = Type.Union([
  PostConditionStxSchema,
  PostConditionFungibleAssetSchema,
  PostConditionNonFungibleAssetSchema,
]);
