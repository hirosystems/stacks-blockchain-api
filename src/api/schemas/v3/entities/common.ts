import { Static, Type } from '@sinclair/typebox';

export const AddressSchema = Type.String({
  pattern: '^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{28,41}',
  title: 'Stacks Address',
  description: 'Stacks Address',
  examples: ['SP318Q55DEKHRXJK696033DQN5C54D9K2EE6DHRWP'],
});
export type Address = Static<typeof AddressSchema>;

export const SmartContractIdSchema = Type.String({
  pattern: '^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{28,41}.[a-zA-Z]([a-zA-Z0-9]|[-_]){0,39}$',
  title: 'Smart Contract ID',
  description: 'Smart Contract ID',
  examples: ['SP000000000000000000002Q6VF78.pox-3'],
});
export type SmartContractId = Static<typeof SmartContractIdSchema>;

export const PrincipalSchema = Type.Union([AddressSchema, SmartContractIdSchema]);
export type Principal = Static<typeof PrincipalSchema>;

export const TransactionIdSchema = Type.String({
  pattern: '^(0x)?[a-fA-F0-9]{64}$',
  title: 'Transaction ID',
  description: 'Transaction ID',
  examples: ['0xf6bd5f4a7b26184a3466340b2e99fd003b4962c0e382a7e4b6a13df3dd7a91c6'],
});
export type TransactionId = Static<typeof TransactionIdSchema>;

export const BlockHashSchema = Type.String({
  pattern: '^(0x)?[a-fA-F0-9]{64}$',
  title: 'Block hash',
  description: 'Block hash',
  examples: ['0xdaf79950c5e8bb0c620751333967cdd62297137cdaf79950c5e8bb0c62075133'],
});
export type BlockHash = Static<typeof BlockHashSchema>;

export const BlockHeightSchema = Type.Integer({
  title: 'Block height',
  description: 'Block height',
  examples: [777678],
});
export type BlockHeight = Static<typeof BlockHeightSchema>;

export const BlockHeightOrHashSchema = Type.Union([
  Type.Literal('latest'),
  // Hash must come before height so the AJV union matches a hex string before attempting
  // integer coercion (which would otherwise turn '0x…deadbeef' into 3735928559).
  BlockHashSchema,
  BlockHeightSchema,
]);
export type BlockHeightOrHash = Static<typeof BlockHeightOrHashSchema>;

export const DecodedClarityValueSchema = Type.Object({
  hex: Type.String(),
  repr: Type.String(),
});
export type DecodedClarityValue = Static<typeof DecodedClarityValueSchema>;

export const ExecutionCostSchema = Type.Object({
  read_count: Type.Integer({
    description: 'Number of reads in the transaction',
  }),
  read_length: Type.Integer({
    description: 'Length of reads in the transaction',
  }),
  runtime: Type.Integer({
    description: 'Runtime of the transaction',
  }),
  write_count: Type.Integer({
    description: 'Number of writes in the transaction',
  }),
  write_length: Type.Integer({
    description: 'Length of writes in the transaction',
  }),
});
export type ExecutionCost = Static<typeof ExecutionCostSchema>;
