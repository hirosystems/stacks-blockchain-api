-- =============================================================================
-- MIGRATION SCRIPT: getAddressTransactions Optimization
-- Eliminates query timeouts for high-transaction addresses
-- =============================================================================

-- Verify no conflicting indexes exist (something like this)
SELECT schemaname, tablename, indexname
FROM pg_indexes 
WHERE indexname LIKE '%_canonical_optimized' 
   OR indexname LIKE '%_subquery_optimized'
ORDER BY tablename, indexname;

-- =============================================================================
-- CANONICAL TRANSACTION FILTERING
-- =============================================================================
-- Problem: The query joins txs table for every transaction to check canonical = TRUE
-- and microblock_canonical = TRUE. This creates expensive nested loops that scan
-- thousands of transactions, applying filters after the join.
--
-- Solution: Create partial index containing only canonical transactions with 
-- built-in ordering. This eliminates the filter step entirely and supports 
-- efficient sorting without additional operations
--
-- Trade-off: Additional storage on txs table to get significant query speedup.
-- But index only contains canonical transactions which should reduce overall size

CREATE INDEX CONCURRENTLY idx_txs_canonical_optimized 
ON txs (tx_id, index_block_hash, microblock_hash, block_height DESC, microblock_sequence DESC, tx_index DESC)
WHERE canonical = TRUE AND microblock_canonical = TRUE;

-- Optional index `address_txs` CTE if it were materialized as its own table
-- CREATE INDEX CONCURRENTLY idx_address_txs_dedupe
-- ON address_txs (tx_id, index_block_hash, microblock_hash);

ANALYZE txs;

-- =============================================================================
-- EVENT TABLE SUBQUERIES
-- =============================================================================
-- Problem: Each transaction requires 11 correlated subqueries that scan event tables
-- using expensive bitmap operations. For 50 returned transactions, this means 550
-- separate bitmap scans combining tx_id and index_block_hash lookups
--
-- Solution: Create compound indexes that cover all subquery conditions in a single
-- lookup. The INCLUDE clause adds frequently accessed columns without increasing
-- the index key size, enabling index-only scans
--
-- Trade-off: Additional storage per event table to remov bitmap
-- operations and heap lookups in subqueries

-- STX Events: used in 5 subqueries per transaction
CREATE INDEX CONCURRENTLY idx_stx_events_subquery_optimized
ON stx_events (tx_id, index_block_hash, microblock_hash, asset_event_type_id)
INCLUDE (amount, sender, recipient);

-- FT Events: used in 3 subqueries per transaction
CREATE INDEX CONCURRENTLY idx_ft_events_subquery_optimized
ON ft_events (tx_id, index_block_hash, microblock_hash, asset_event_type_id)
INCLUDE (sender, recipient);

-- NFT Events: used in 3 subqueries
CREATE INDEX CONCURRENTLY idx_nft_events_subquery_optimized
ON nft_events (tx_id, index_block_hash, microblock_hash, asset_event_type_id)
INCLUDE (sender, recipient);

ANALYZE stx_events, ft_events, nft_events;

-- =============================================================================
-- MONITORING / VERIFICATION
-- =============================================================================

-- Ensure all indexes were created successfully and are valid
SELECT 
    psi.schemaname,
    psi.relname as tablename,
    psi.indexrelname,
    pi.indisvalid as is_valid,
    pi.indisready as is_ready,
    pg_size_pretty(pg_relation_size(psi.indexrelid)) as index_size
FROM pg_stat_user_indexes psi
JOIN pg_index pi ON psi.indexrelid = pi.indexrelid 
WHERE psi.indexrelname LIKE '%_canonical_optimized'
   OR psi.indexrelname LIKE '%_subquery_optimized'
ORDER BY psi.relname, psi.indexrelname;

-- Create view to monitor ongoing performance tracking
CREATE OR REPLACE VIEW address_transactions_performance AS
SELECT 
    schemaname,
    relname as tablename,
    pg_stat_user_indexes.indexrelname,
    idx_scan as times_used,
    pg_size_pretty(pg_relation_size(indexrelid)) as index_size,
    CASE 
        WHEN idx_scan = 0 THEN 'Not yet used'
        WHEN idx_scan < 100 THEN 'Low usage'  
        ELSE 'Active'
    END as status
FROM pg_stat_user_indexes 
WHERE pg_stat_user_indexes.indexrelname LIKE '%_canonical_optimized' 
   OR pg_stat_user_indexes.indexrelname LIKE '%_subquery_optimized'
ORDER BY idx_scan DESC;

SELECT * FROM address_transactions_performance;

-- Verify all indexes are valid and being used
SELECT 
    schemaname, relname, pg_stat_user_indexes.indexrelname, idx_scan,
    CASE 
        WHEN idx_scan = 0 THEN 'INDEX NOT USED - INVESTIGATE'
        ELSE 'OK'
    END as health_status
FROM pg_stat_user_indexes 
WHERE pg_stat_user_indexes.indexrelname LIKE '%_optimized'
ORDER BY idx_scan DESC;

/*
-- Rollback:
DROP INDEX CONCURRENTLY IF EXISTS idx_stx_events_subquery_optimized;
DROP INDEX CONCURRENTLY IF EXISTS idx_ft_events_subquery_optimized;
DROP INDEX CONCURRENTLY IF EXISTS idx_nft_events_subquery_optimized;
DROP INDEX CONCURRENTLY IF EXISTS idx_txs_canonical_optimized;

ANALYZE txs, stx_events, ft_events, nft_events;

DROP VIEW IF EXISTS address_transactions_performance;
*/