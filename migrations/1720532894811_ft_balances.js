/** @param { import("node-pg-migrate").MigrationBuilder } pgm */
exports.up = pgm => {
  pgm.createTable('ft_balances', {
    id: {
      type: 'bigserial',
      primaryKey: true,
    },
    address: {
      type: 'text',
      notNull: true,
    },
    token: {
      type: 'text',
      notNull: true,
    },
    balance: {
      type: 'numeric',
      notNull: true,
    }
  });

  pgm.addConstraint('ft_balances', 'unique_address_token', `UNIQUE(address, token)`);

  // Speeds up "grab the addresses with the highest balance for a given token" queries
  pgm.createIndex('ft_balances', [{ name: 'token' }, { name: 'balance', sort: 'DESC' }]);

  // Speeds up "get the total supply of a given token" queries
  pgm.createIndex('ft_balances', 'token');

  // Populate the table with the current stx balances
  pgm.sql(`
    WITH all_balances AS (
        SELECT sender AS address, -SUM(amount) AS balance_change
        FROM stx_events
        WHERE asset_event_type_id IN (1, 3) -- Transfers and Burns affect the sender's balance
        AND canonical = true AND microblock_canonical = true
        GROUP BY sender
      UNION ALL
        SELECT recipient AS address, SUM(amount) AS balance_change
        FROM stx_events
        WHERE asset_event_type_id IN (1, 2) -- Transfers and Mints affect the recipient's balance
        AND canonical = true AND microblock_canonical = true
        GROUP BY recipient
    ),
    net_balances AS (
      SELECT address, SUM(balance_change) AS balance
      FROM all_balances
      GROUP BY address
    ),
    fees AS (
      SELECT address, SUM(total_fees) AS total_fees
      FROM (
          SELECT sender_address AS address, SUM(fee_rate) AS total_fees
          FROM txs
          WHERE canonical = true AND microblock_canonical = true AND sponsored = false
          GROUP BY sender_address
        UNION ALL
          SELECT sponsor_address AS address, SUM(fee_rate) AS total_fees
          FROM txs
          WHERE canonical = true AND microblock_canonical = true AND sponsored = true
          GROUP BY sponsor_address
      ) AS subquery
      GROUP BY address
    ),
    rewards AS (
      SELECT
        recipient AS address,
        SUM(
          coinbase_amount + tx_fees_anchored + tx_fees_streamed_confirmed + tx_fees_streamed_produced
        ) AS total_rewards
      FROM miner_rewards
      WHERE canonical = true
      GROUP BY recipient
    ),
    all_addresses AS (
      SELECT address FROM net_balances
      UNION
      SELECT address FROM fees
      UNION
      SELECT address FROM rewards
    )
    INSERT INTO ft_balances (address, balance, token)
    SELECT
      aa.address,
      COALESCE(nb.balance, 0) - COALESCE(f.total_fees, 0) + COALESCE(r.total_rewards, 0) AS balance,
      'stx' AS token
    FROM all_addresses aa
    LEFT JOIN net_balances nb ON aa.address = nb.address
    LEFT JOIN fees f ON aa.address = f.address
    LEFT JOIN rewards r ON aa.address = r.address
  `);

  // Populate the table with the current FT balances
  pgm.sql(`
    WITH all_balances AS (
        SELECT sender AS address, asset_identifier, -SUM(amount) AS balance_change
        FROM ft_events
        WHERE asset_event_type_id IN (1, 3) -- Transfers and Burns affect the sender's balance
          AND canonical = true 
          AND microblock_canonical = true
        GROUP BY sender, asset_identifier
      UNION ALL
        SELECT recipient AS address, asset_identifier, SUM(amount) AS balance_change
        FROM ft_events
        WHERE asset_event_type_id IN (1, 2) -- Transfers and Mints affect the recipient's balance
          AND canonical = true 
          AND microblock_canonical = true
        GROUP BY recipient, asset_identifier
    ),
    net_balances AS (
      SELECT address, asset_identifier, SUM(balance_change) AS balance
      FROM all_balances
      GROUP BY address, asset_identifier
    )
    INSERT INTO ft_balances (address, balance, token)
    SELECT address, balance, asset_identifier AS token
    FROM net_balances
  `);

};

/** @param { import("node-pg-migrate").MigrationBuilder } pgm */
exports.down = pgm => {
  pgm.dropTable('ft_balances');
};
