import { DbCycleSigner } from '../../../datastore/v3/types.js';
import { CycleSigner } from '../../schemas/v3/entities/staking-cycles.js';

export function serializeDbCycleSigner(signer: DbCycleSigner, cycleNumber: number): CycleSigner {
  return {
    signing_key: signer.signing_key,
    weight: {
      amount: signer.weight,
      percent: signer.weight_percent,
    },
    stacked_amount: {
      amount: signer.stacked_amount,
      percent: signer.stacked_amount_percent,
    },
    signer_managers: signer.signer_managers.map(m => ({
      signer_manager: m.signer_manager,
      auth_id: m.auth_id,
      granted_at: {
        block_height: m.block_height,
        burn_block_height: m.burn_block_height,
        tx_id: m.tx_id,
      },
      // Bindings made after the cycle's anchor block take effect next cycle.
      pending_key_update: m.pending_signer_key
        ? { signer_key: m.pending_signer_key, effective_cycle: cycleNumber + 1 }
        : null,
    })),
  };
}
