import { Static, Type } from '@sinclair/typebox';

export const StxSupplySchema = Type.Object(
  {
    total: Type.String({
      description:
        'Total liquid STX supply as a string-quoted integer of micro-STX (µSTX): all STX ' +
        'minted (including vesting schedule unlocks) plus matured miner coinbase rewards, ' +
        'minus burned STX',
      examples: ['1470469916700000'],
    }),
    projected_total_2050: Type.String({
      description:
        'Projected total STX supply in the year 2050, as a string-quoted integer of micro-STX ' +
        '(µSTX). STX supply grows approx 0.3% annually thereafter in perpetuity.',
      examples: ['2318000000000000'],
    }),
  },
  { title: 'StxSupply' }
);
export type StxSupply = Static<typeof StxSupplySchema>;
