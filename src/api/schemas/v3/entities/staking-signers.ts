import { Static, Type } from '@sinclair/typebox';
import {
  BitcoinBlockPositionSchema,
  BlockPositionSchema,
  PrincipalSchema,
  TransactionIdSchema,
} from './common.js';

export const StakingSignerSchema = Type.Object(
  {
    signer: PrincipalSchema,
    signer_key: Type.String({
      description: 'The registered compressed secp256k1 public key, as a `0x`-prefixed hex string',
      examples: ['0x03a0f9e1...'],
    }),
  },
  { title: 'StakingSigner' }
);
export type StakingSigner = Static<typeof StakingSignerSchema>;

/** A staker that belongs to a signer, and the staking type(s) it participates in. */
export const SignerStakerSchema = Type.Object(
  {
    staker: PrincipalSchema,
    staking_types: Type.Array(Type.Union([Type.Literal('stx'), Type.Literal('bond')]), {
      description:
        'The staking types this staker participates in under this signer: `stx` for direct pox-5 STX staking, `bond` for BTC/sBTC bond staking. A staker doing both has both entries.',
      examples: [['stx'], ['bond'], ['stx', 'bond']],
    }),
  },
  { title: 'SignerStaker' }
);
export type SignerStaker = Static<typeof SignerStakerSchema>;

/** A single signer with the block position of the transaction that registered its key. */
export const StakingSignerDetailSchema = Type.Composite(
  [
    StakingSignerSchema,
    Type.Object({
      transaction: Type.Object({
        tx_id: TransactionIdSchema,
        block: BlockPositionSchema,
        bitcoin_block: BitcoinBlockPositionSchema,
      }),
    }),
  ],
  { title: 'StakingSignerDetail' }
);
export type StakingSignerDetail = Static<typeof StakingSignerDetailSchema>;
