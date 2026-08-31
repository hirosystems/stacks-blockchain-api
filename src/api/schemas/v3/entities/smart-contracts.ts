import { Static, Type } from '@sinclair/typebox';
import {
  BitcoinBlockPositionSchema,
  BlockPositionSchema,
  SmartContractIdSchema,
  TransactionIdSchema,
} from './common.js';

export const SmartContractSchema = Type.Object(
  {
    contract_id: SmartContractIdSchema,
    clarity_version: Type.Integer({
      description: 'The Clarity version the contract runs under.',
      examples: [3],
    }),
    tx_id: Type.String({
      ...TransactionIdSchema,
      description: 'ID of the transaction that deployed this contract',
    }),
    block: BlockPositionSchema,
    bitcoin_block: BitcoinBlockPositionSchema,
    source_code: Type.Optional(
      Type.String({
        description:
          'The Clarity source code of the contract. Only present when requested via the ' +
          '`include=source_code` query param.',
      })
    ),
  },
  { title: 'SmartContract' }
);
export type SmartContract = Static<typeof SmartContractSchema>;

/**
 * Heavy fields that callers can opt into via `?include=...`. Omitted by default to keep the
 * response lean, since contract source code is unbounded in size.
 */
export const SmartContractIncludeFieldSchema = Type.Literal('source_code');
export type SmartContractIncludeField = Static<typeof SmartContractIncludeFieldSchema>;
