/* eslint-disable @typescript-eslint/camelcase */
import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createMaterializedView('latest_contract_txs', {}, `
    WITH contract_txs AS (
      SELECT
        contract_call_contract_id AS contract_id, tx_id,
        block_height, microblock_sequence, tx_index
      FROM txs
      WHERE
        contract_call_contract_id IS NOT NULL
        AND canonical = TRUE
        AND microblock_canonical = TRUE
      UNION
      SELECT
        smart_contract_contract_id AS contract_id, tx_id,
        block_height, microblock_sequence, tx_index
      FROM txs
      WHERE
        smart_contract_contract_id IS NOT NULL
        AND canonical = TRUE
        AND microblock_canonical = TRUE
      UNION
      SELECT
        sender_address AS contract_id, tx_id,
        block_height, microblock_sequence, tx_index
      FROM txs
      WHERE
        sender_address LIKE '%.%'
        AND canonical = TRUE
        AND microblock_canonical = TRUE
      UNION
      SELECT
        token_transfer_recipient_address AS contract_id, tx_id,
        block_height, microblock_sequence, tx_index
      FROM txs
      WHERE
        token_transfer_recipient_address LIKE '%.%'
        AND canonical = TRUE
        AND microblock_canonical = TRUE
    ),
    numbered_txs AS (
      SELECT
        ROW_NUMBER() OVER (
          PARTITION BY contract_id
          ORDER BY block_height DESC, microblock_sequence DESC, tx_index DESC
        ) AS r,
        contract_txs.*
      FROM contract_txs
    )
    SELECT numbered_txs.contract_id, txs.*
    FROM numbered_txs
    INNER JOIN txs USING (tx_id)
    WHERE numbered_txs.r <= 50
  `);

  pgm.createIndex('latest_contract_txs', 'contract_id');
  pgm.createIndex('latest_contract_txs', [
    { name: 'block_height', sort: 'DESC' },
    { name: 'microblock_sequence', sort: 'DESC'},
    { name: 'tx_index', sort: 'DESC' }
  ]);
}
