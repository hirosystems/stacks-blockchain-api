import { Static, Type } from '@sinclair/typebox';

export const AddressParamSchema = Type.String({
  pattern: '^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{28,41}',
  title: 'Stacks Address',
  description: 'Stacks Address',
  examples: ['SP318Q55DEKHRXJK696033DQN5C54D9K2EE6DHRWP'],
});
export type Address = Static<typeof AddressParamSchema>;

export const SmartContractIdParamSchema = Type.String({
  pattern: '^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{28,41}.[a-zA-Z]([a-zA-Z0-9]|[-_]){0,39}$',
  title: 'Smart Contract ID',
  description: 'Smart Contract ID',
  examples: ['SP000000000000000000002Q6VF78.pox-3'],
});
export type SmartContractId = Static<typeof SmartContractIdParamSchema>;

export const PrincipalSchema = Type.Union([AddressParamSchema, SmartContractIdParamSchema]);
export type Principal = Static<typeof PrincipalSchema>;

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
