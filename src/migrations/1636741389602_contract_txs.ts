/* eslint-disable @typescript-eslint/camelcase */
import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createMaterializedView('contract_txs', {}, `
    SELECT contract_call_contract_id AS contract_id, *
      FROM txs
      WHERE contract_call_contract_id IS NOT NULL AND canonical = TRUE AND microblock_canonical = TRUE
    UNION
    SELECT smart_contract_contract_id AS contract_id, *
      FROM txs
      WHERE smart_contract_contract_id IS NOT NULL AND canonical = TRUE AND microblock_canonical = TRUE
    UNION
    SELECT sender_address AS contract_id, *
      FROM txs
      WHERE sender_address LIKE '%.%' AND canonical = TRUE AND microblock_canonical = TRUE
    UNION
    SELECT token_transfer_recipient_address AS contract_id, *
      FROM txs
      WHERE token_transfer_recipient_address LIKE '%.%' AND canonical = TRUE AND microblock_canonical = TRUE
  `);

  pgm.createIndex('contract_txs', 'contract_id');
  pgm.createIndex('contract_txs', 'tx_id');
  pgm.createIndex('contract_txs', [
    { name: 'block_height', sort: 'DESC' }
  ]);
  pgm.createIndex('contract_txs', [
    { name: 'block_height', sort: 'DESC' },
    { name: 'microblock_sequence', sort: 'DESC'},
    { name: 'tx_index', sort: 'DESC' }
  ]);
}
