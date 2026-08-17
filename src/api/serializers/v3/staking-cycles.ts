import { DbCycleSigner } from '../../../datastore/v3/types.js';
import { CycleSigner } from '../../schemas/v3/entities/staking-cycles.js';

export function serializeDbCycleSigner(signer: DbCycleSigner, cycleNumber: number): CycleSigner {
  return {
    signing_key: signer.signing_key,
    weight: {
      amount: signer.weight,
      percent: signer.weight_percent,
    },
    staked_stx: {
      amount: signer.stacked_amount,
      percent: signer.stacked_amount_percent,
    },
    signer_managers: signer.signer_managers.map(m => ({
      signer_manager: m.signer_manager,
      registered_at: {
        block_height: m.block_height,
        bitcoin_block_height: m.burn_block_height,
        tx_id: m.tx_id,
      },
      granted_keys: m.granted_keys,
      // The registration stays bound even if its grant is revoked; this flag surfaces whether the
      // bound key's authorization is still live.
      grant_active: m.granted_keys.some(g => g.signer_key === signer.signing_key),
      // Keys registered after the cycle's anchor block take effect next cycle.
      pending_key_update:
        m.pending_signer_key && m.pending_tx_id
          ? {
              signer_key: m.pending_signer_key,
              effective_cycle: cycleNumber + 1,
              tx_id: m.pending_tx_id,
            }
          : null,
    })),
  };
}
