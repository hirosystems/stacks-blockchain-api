import { Static, TSchema, Type } from '@sinclair/typebox';
import { AmountSchema, TransactionIdSchema } from './common.js';

export const FaucetBtcRequestSchema = Type.Object(
  {
    address: Type.String({
      minLength: 1,
      description: 'A valid regtest or signet BTC address',
      examples: ['2N4M94S1ZPt8HfxydXzL2P7qyzgVq7MHWts'],
    }),
  },
  { title: 'FaucetBtcRequest' }
);
export type FaucetBtcRequest = Static<typeof FaucetBtcRequestSchema>;

/** Request body shared by the STX and sBTC faucets, which both pay a Stacks principal. */
export const FaucetStacksRequestSchema = Type.Object(
  {
    address: Type.String({
      minLength: 1,
      description: 'A valid testnet Stacks address',
      examples: ['ST3M7N9Q9HDRM7RVP1Q26P0EE69358PZZAZD7KMXQ'],
    }),
  },
  { title: 'FaucetStacksRequest' }
);
export type FaucetStacksRequest = Static<typeof FaucetStacksRequestSchema>;

/**
 * Faucet responses describe the broadcast transaction and the amount it sends. The amount is
 * grouped under the asset it is denominated in (the same `{ btc, stx, sbtc }` vocabulary the
 * staking entities use) so a caller reading the payload alone knows which token it received and in
 * which base units.
 */
const FaucetTransaction = <TChain extends string>(chain: TChain) =>
  Type.Object({
    tx_id: TransactionIdSchema,
    chain: Type.Literal(chain, {
      description: 'The chain the faucet transaction was broadcast to',
    }),
  });

const FaucetRun = <TChain extends string, TAmount extends TSchema>(
  chain: TChain,
  amount: TAmount,
  title: string
) =>
  Type.Object(
    {
      transaction: FaucetTransaction(chain),
      amount,
    },
    { title }
  );

export const FaucetBtcRunSchema = FaucetRun(
  'bitcoin',
  Type.Object(
    {
      btc: Type.String({
        ...AmountSchema,
        description: 'The BTC sent by the faucet, in satoshis',
        examples: ['10000'],
      }),
    },
    { description: 'The amount sent by the faucet' }
  ),
  'FaucetBtcRun'
);
export type FaucetBtcRun = Static<typeof FaucetBtcRunSchema>;

export const FaucetStxRunSchema = FaucetRun(
  'stacks',
  Type.Object(
    {
      stx: Type.String({
        ...AmountSchema,
        description: 'The STX sent by the faucet, in µSTX',
        examples: ['500000000'],
      }),
    },
    { description: 'The amount sent by the faucet' }
  ),
  'FaucetStxRun'
);
export type FaucetStxRun = Static<typeof FaucetStxRunSchema>;

export const FaucetSbtcRunSchema = FaucetRun(
  'stacks',
  Type.Object(
    {
      sbtc: Type.String({
        ...AmountSchema,
        description: 'The sBTC sent by the faucet, in satoshis',
        examples: ['10000'],
      }),
    },
    { description: 'The amount sent by the faucet' }
  ),
  'FaucetSbtcRun'
);
export type FaucetSbtcRun = Static<typeof FaucetSbtcRunSchema>;

export const FaucetErrorSchema = Type.Object(
  {
    error: Type.String({ description: 'Error message' }),
  },
  { title: 'FaucetError' }
);
export type FaucetError = Static<typeof FaucetErrorSchema>;
