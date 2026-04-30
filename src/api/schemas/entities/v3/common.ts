import { Static, Type } from '@sinclair/typebox';

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
