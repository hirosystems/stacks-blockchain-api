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
