import { Static, Type } from '@sinclair/typebox';

export const BurnBlockPoxTxSchema = Type.Object({
  burn_block_height: Type.Integer({ description: 'Height of the burn block' }),
  burn_block_hash: Type.String({ description: 'Hash of the burn block' }),
  tx_id: Type.String({ description: 'Transaction ID' }),
  recipient: Type.String({ description: 'Recipient address' }),
  utxo_idx: Type.Integer({ description: 'UTXO index' }),
  amount: Type.String({ description: 'Amount' }),
});
export type BurnBlockPoxTx = Static<typeof BurnBlockPoxTxSchema>;
