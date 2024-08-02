import { Static, Type } from '@sinclair/typebox';
import { Nullable } from '../util';

export const SmartContractSchema = Type.Object(
  {
    tx_id: Type.String(),
    canonical: Type.Boolean(),
    contract_id: Type.String(),
    block_height: Type.Integer(),
    clarity_version: Nullable(Type.Integer()),
    source_code: Type.String(),
    abi: Nullable(Type.String()),
  },
  {
    title: 'SmartContract',
    description: 'A Smart Contract Detail',
  }
);
export type SmartContract = Static<typeof SmartContractSchema>;

export const SmartContractStatusFoundSchema = Type.Object({
  found: Type.Literal(true),
  result: Type.Object({
    status: Type.String({
      description: 'Smart contract deployment transaction status',
    }),
    tx_id: Type.String({ description: 'Deployment transaction ID' }),
    contract_id: Type.String({ description: 'Smart contract ID' }),
    block_height: Type.Optional(
      Type.Integer({
        description: 'Height of the transaction confirmation block',
      })
    ),
  }),
});
export type SmartContractStatusFound = Static<typeof SmartContractStatusFoundSchema>;

export const SmartContractStatusNotFoundSchema = Type.Object({
  found: Type.Literal(false),
});
export type SmartContractStatusNotFound = Static<typeof SmartContractStatusNotFoundSchema>;

export const SmartContractStatusListSchema = Type.Record(
  Type.String({ description: 'Smart contract ID' }),
  Type.Union([SmartContractStatusFoundSchema, SmartContractStatusNotFoundSchema])
);
export type SmartContractStatusList = Static<typeof SmartContractStatusListSchema>;
