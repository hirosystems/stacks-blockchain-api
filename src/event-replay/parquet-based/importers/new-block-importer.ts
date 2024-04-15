import { Readable, Writable, Transform } from 'stream';
import { pipeline } from 'stream/promises';
import { PgWriteStore } from '../../../datastore/pg-write-store';
import { parseNewBlockMessage } from '../../../event-stream/event-server';
import {
  DbBlock,
  DbMicroblock,
  DbTx,
  SmartContractEventInsertValues,
  StxEventInsertValues,
  PrincipalStxTxsInsertValues,
  FtEventInsertValues,
  NftEventInsertValues,
  BnsNameInsertValues,
  BnsZonefileInsertValues,
  DataStoreBlockUpdateData,
} from '../../../datastore/common';
import { validateZonefileHash } from '../../../datastore/helpers';
import { logger } from '../../../logger';
import { getApiConfiguredChainID } from '../../../helpers';
import { CoreNodeBlockMessage } from '../../../event-stream/core-node-message';
import { DatasetStore } from '../dataset/store';
import { batchIterate } from '@hirosystems/api-toolkit';

const chainID = getApiConfiguredChainID();

const batchInserters: BatchInserter[] = [];

interface BatchInserter<T = any> {
  push(entries: T[]): Promise<void>;
  flush(): Promise<void>;
}

function createBatchInserter<T>({
  batchSize,
  insertFn,
}: {
  batchSize: number;
  insertFn: (entries: T[]) => Promise<void>;
}): BatchInserter<T> {
  let entryBuffer: T[] = [];
  return {
    async push(entries: T[]) {
      entries.length === 1
        ? entryBuffer.push(entries[0])
        : entries.forEach(e => entryBuffer.push(e));
      if (entryBuffer.length === batchSize) {
        await insertFn(entryBuffer);
        entryBuffer.length = 0;
      } else if (entryBuffer.length > batchSize) {
        for (const batch of batchIterate(entryBuffer, batchSize)) {
          await insertFn(batch);
        }
        entryBuffer.length = 0;
      }
    },
    async flush() {
      logger.debug({ component: 'event-replay' }, 'Flushing remaining data...');
      if (entryBuffer.length > 0) {
        await insertFn(entryBuffer);
        entryBuffer = [];
      }
    },
  };
}

const populateBatchInserters = (db: PgWriteStore) => {
  const dbBlockBatchInserter = createBatchInserter<DbBlock>({
    batchSize: 500,
    insertFn: entries => {
      logger.debug({ component: 'event-replay' }, 'Inserting into blocks table...');
      return db.insertBlockBatch(db.sql, entries);
    },
  });
  batchInserters.push(dbBlockBatchInserter);

  const dbMicroblockBatchInserter = createBatchInserter<DbMicroblock>({
    batchSize: 500,
    insertFn: entries => {
      logger.debug({ component: 'event-replay' }, 'Inserting into microblocks table...');
      return db.insertMicroblockBatch(db.sql, entries);
    },
  });
  batchInserters.push(dbMicroblockBatchInserter);

  const dbTxBatchInserter = createBatchInserter<DbTx>({
    batchSize: 1000,
    insertFn: entries => {
      logger.debug({ component: 'event-replay' }, 'Inserting into txs table...');
      return db.insertTxBatch(db.sql, entries);
    },
  });
  batchInserters.push(dbTxBatchInserter);

  const dbStxEventBatchInserter = createBatchInserter<StxEventInsertValues>({
    batchSize: 500,
    insertFn: entries => {
      logger.debug({ component: 'event-replay' }, 'Inserting into stx_events table...');
      return db.insertStxEventBatch(db.sql, entries);
    },
  });
  batchInserters.push(dbStxEventBatchInserter);

  const dbPrincipalStxTxBatchInserter = createBatchInserter<PrincipalStxTxsInsertValues>({
    batchSize: 500,
    insertFn: entries => {
      logger.debug({ component: 'event-replay' }, 'Inserting into principal_stx_txs table...');
      return db.insertPrincipalStxTxsBatch(db.sql, entries);
    },
  });
  batchInserters.push(dbPrincipalStxTxBatchInserter);

  const dbContractEventBatchInserter = createBatchInserter<SmartContractEventInsertValues>({
    batchSize: 500,
    insertFn: entries => {
      logger.debug({ component: 'event-replay' }, 'Inserting into contract_logs table...');
      return db.insertContractEventBatch(db.sql, entries);
    },
  });
  batchInserters.push(dbContractEventBatchInserter);

  const dbFtEventBatchInserter = createBatchInserter<FtEventInsertValues>({
    batchSize: 500,
    insertFn: entries => {
      logger.debug({ component: 'event-replay' }, 'Inserting into ft_events table...');
      return db.insertFtEventBatch(db.sql, entries);
    },
  });
  batchInserters.push(dbFtEventBatchInserter);

  const dbNftEventBatchInserter = createBatchInserter<NftEventInsertValues>({
    batchSize: 500,
    insertFn: entries => {
      logger.debug({ component: 'event-replay' }, 'Inserting into nft_events table...');
      return db.insertNftEventBatch(db.sql, entries);
    },
  });
  batchInserters.push(dbNftEventBatchInserter);

  const dbNameBatchInserter = createBatchInserter<BnsNameInsertValues>({
    batchSize: 500,
    insertFn: entries => {
      logger.debug({ component: 'event-replay' }, 'Inserting into names table...');
      return db.insertNameBatch(db.sql, entries);
    },
  });
  batchInserters.push(dbNameBatchInserter);

  const dbZonefileBatchInserter = createBatchInserter<BnsZonefileInsertValues>({
    batchSize: 500,
    insertFn: entries => {
      logger.debug({ component: 'event-replay' }, 'Inserting into zonefiles table...');
      return db.insertZonefileBatch(db.sql, entries);
    },
  });
  batchInserters.push(dbZonefileBatchInserter);

  return new Writable({
    objectMode: true,
    write: async (data: CoreNodeBlockMessage, _encoding, next) => {
      let dbData: DataStoreBlockUpdateData;
      try {
        dbData = parseNewBlockMessage(chainID, data);
      } catch (err) {
        logger.error({ component: 'event-replay' }, 'Error when parsing new_block event');
        console.error(err);

        throw err;
      }

      const insertTxs = async (dbData: DataStoreBlockUpdateData) => {
        for (const entry of dbData.txs) {
          await dbTxBatchInserter.push([entry.tx]);
        }
      };

      const insertContractLogs = async (dbData: DataStoreBlockUpdateData) => {
        for (const entry of dbData.txs) {
          await dbContractEventBatchInserter.push(
            entry.contractLogEvents.map((contractEvent: any) => ({
              event_index: contractEvent.event_index,
              tx_id: contractEvent.tx_id,
              tx_index: contractEvent.tx_index,
              block_height: contractEvent.block_height,
              index_block_hash: entry.tx.index_block_hash,
              parent_index_block_hash: entry.tx.parent_index_block_hash,
              microblock_hash: entry.tx.microblock_hash,
              microblock_sequence: entry.tx.microblock_sequence,
              microblock_canonical: entry.tx.microblock_canonical,
              canonical: contractEvent.canonical,
              contract_identifier: contractEvent.contract_identifier,
              topic: contractEvent.topic,
              value: contractEvent.value,
            }))
          );
        }
      };

      const insertStxEvents = async (dbData: DataStoreBlockUpdateData) => {
        for (const entry of dbData.txs) {
          for (const stxEvent of entry.stxEvents) {
            await dbStxEventBatchInserter.push([
              {
                ...stxEvent,
                index_block_hash: entry.tx.index_block_hash,
                parent_index_block_hash: entry.tx.parent_index_block_hash,
                microblock_hash: entry.tx.microblock_hash,
                microblock_sequence: entry.tx.microblock_sequence,
                microblock_canonical: entry.tx.microblock_canonical,
                sender: stxEvent.sender ?? null,
                recipient: stxEvent.recipient ?? null,
                amount: stxEvent.amount ?? null,
                memo: stxEvent.memo ?? null,
              },
            ]);
          }
        }
      };

      const insertPrincipalStxTxs = async (dbData: DataStoreBlockUpdateData) => {
        for (const entry of dbData.txs) {
          // string key: `principal, tx_id, index_block_hash, microblock_hash`
          const alreadyInsertedRowKeys = new Set<string>();
          const values: PrincipalStxTxsInsertValues[] = [];
          const push = (principal: string) => {
            // Check if this row has already been inserted by comparing the same columns used in the
            // sql unique constraint defined on the table. This prevents later errors during re-indexing
            // when the table indexes/constraints are temporarily disabled during inserts.
            const constraintKey = `${principal},${entry.tx.tx_id},${entry.tx.index_block_hash},${entry.tx.microblock_hash}`;
            if (!alreadyInsertedRowKeys.has(constraintKey)) {
              alreadyInsertedRowKeys.add(constraintKey);
              values.push({
                principal: principal,
                tx_id: entry.tx.tx_id,
                block_height: entry.tx.block_height,
                index_block_hash: entry.tx.index_block_hash,
                microblock_hash: entry.tx.microblock_hash,
                microblock_sequence: entry.tx.microblock_sequence,
                tx_index: entry.tx.tx_index,
                canonical: entry.tx.canonical,
                microblock_canonical: entry.tx.microblock_canonical,
              });
            }
          };

          const principals = new Set<string>();

          // Insert tx data
          [
            entry.tx.sender_address,
            entry.tx.token_transfer_recipient_address,
            entry.tx.contract_call_contract_id,
            entry.tx.smart_contract_contract_id,
          ]
            .filter((p): p is string => !!p)
            .forEach(p => principals.add(p));

          // Insert stx_event data
          entry.stxEvents.forEach((event: any) => {
            if (event.sender) {
              principals.add(event.sender);
            }
            if (event.recipient) {
              principals.add(event.recipient);
            }
          });

          principals.forEach(principal => push(principal));
          await dbPrincipalStxTxBatchInserter.push(values);
        }
      };

      const insertFTEvents = async (dbData: DataStoreBlockUpdateData) => {
        for (const entry of dbData.txs) {
          await dbFtEventBatchInserter.push(
            entry.ftEvents.map((ftEvent: any) => ({
              event_index: ftEvent.event_index,
              tx_id: ftEvent.tx_id,
              tx_index: ftEvent.tx_index,
              block_height: ftEvent.block_height,
              index_block_hash: entry.tx.index_block_hash,
              parent_index_block_hash: entry.tx.parent_index_block_hash,
              microblock_hash: entry.tx.microblock_hash,
              microblock_sequence: entry.tx.microblock_sequence,
              microblock_canonical: entry.tx.microblock_canonical,
              canonical: ftEvent.canonical,
              asset_event_type_id: ftEvent.asset_event_type_id,
              sender: ftEvent.sender ?? null,
              recipient: ftEvent.recipient ?? null,
              asset_identifier: ftEvent.asset_identifier,
              amount: ftEvent.amount.toString(),
            }))
          );
        }
      };

      const insertNFTEvents = async (dbData: DataStoreBlockUpdateData) => {
        for (const entry of dbData.txs) {
          await dbNftEventBatchInserter.push(
            entry.nftEvents.map((nftEvent: any) => ({
              tx_id: nftEvent.tx_id,
              index_block_hash: entry.tx.index_block_hash,
              parent_index_block_hash: entry.tx.parent_index_block_hash,
              microblock_hash: entry.tx.microblock_hash,
              microblock_sequence: entry.tx.microblock_sequence,
              microblock_canonical: entry.tx.microblock_canonical,
              sender: nftEvent.sender ?? null,
              recipient: nftEvent.recipient ?? null,
              event_index: nftEvent.event_index,
              tx_index: nftEvent.tx_index,
              block_height: nftEvent.block_height,
              canonical: nftEvent.canonical,
              asset_event_type_id: nftEvent.asset_event_type_id,
              asset_identifier: nftEvent.asset_identifier,
              value: nftEvent.value,
            }))
          );
        }
      };

      const insertNames = async (dbData: DataStoreBlockUpdateData) => {
        for (const entry of dbData.txs) {
          await dbNameBatchInserter.push(
            entry.names.map((bnsName: any) => ({
              name: bnsName.name,
              address: bnsName.address,
              registered_at: bnsName.registered_at,
              expire_block: bnsName.expire_block,
              zonefile_hash: validateZonefileHash(bnsName.zonefile_hash),
              namespace_id: bnsName.namespace_id,
              grace_period: bnsName.grace_period ?? null,
              renewal_deadline: bnsName.renewal_deadline ?? null,
              resolver: bnsName.resolver ?? null,
              tx_id: bnsName.tx_id ?? null,
              tx_index: bnsName.tx_index,
              event_index: bnsName.event_index ?? null,
              status: bnsName.status ?? null,
              canonical: bnsName.canonical,
              index_block_hash: entry.tx.index_block_hash ?? null,
              parent_index_block_hash: entry.tx.parent_index_block_hash,
              microblock_hash: entry.tx.microblock_hash,
              microblock_sequence: entry.tx.microblock_sequence,
              microblock_canonical: entry.tx.microblock_canonical,
            }))
          );
        }
      };

      const insertZoneFiles = async (dbData: DataStoreBlockUpdateData) => {
        for (const entry of dbData.txs) {
          await dbZonefileBatchInserter.push(
            entry.names.map((bnsName: any) => ({
              name: bnsName.name,
              zonefile: bnsName.zonefile,
              zonefile_hash: validateZonefileHash(bnsName.zonefile_hash),
              tx_id: bnsName.tx_id,
              index_block_hash: bnsName.index_block_hash ?? null,
            }))
          );
        }
      };

      const insertSmartContracts = async (dbData: DataStoreBlockUpdateData) => {
        for (const entry of dbData.txs) {
          await db.updateSmartContracts(db.sql, entry.tx, entry.smartContracts);
        }
      };

      const insertNamespaces = async (dbData: DataStoreBlockUpdateData) => {
        for (const entry of dbData.txs) {
          for (const namespace of entry.namespaces) {
            await db.insertNamespace(db.sql, entry.tx, namespace);
          }
        }
      };

      const insertStxLockEvents = async (dbData: DataStoreBlockUpdateData) => {
        for (const entry of dbData.txs) {
          await db.updateStxLockEvents(db.sql, [entry]);
        }
      };

      const insertMinerRewards = async (dbData: DataStoreBlockUpdateData) => {
        await db.updateMinerRewards(db.sql, dbData.minerRewards);
      };

      const insertPox2Events = async (dbData: DataStoreBlockUpdateData) => {
        for (const entry of dbData.txs) {
          await db.updatePoxSyntheticEvents(db.sql, 'pox2_events', [entry]);
        }
      };

      const insertPox3Events = async (dbData: DataStoreBlockUpdateData) => {
        for (const entry of dbData.txs) {
          await db.updatePoxSyntheticEvents(db.sql, 'pox3_events', [entry]);
        }
      };

      const insertPox4Events = async (dbData: DataStoreBlockUpdateData) => {
        for (const entry of dbData.txs) {
          await db.updatePoxSyntheticEvents(db.sql, 'pox4_events', [entry]);
        }
      };

      await Promise.all([
        // Insert blocks
        dbBlockBatchInserter.push([dbData.block]),
        // Insert microblocks
        dbMicroblockBatchInserter.push(dbData.microblocks),
        // Insert txs
        insertTxs(dbData),
        // Insert stx_events
        insertStxEvents(dbData),
        // Insert principal_stx_txs
        insertPrincipalStxTxs(dbData),
        // Insert contract_logs
        insertContractLogs(dbData),
        // Insert ft_events
        insertFTEvents(dbData),
        // Insert nft_events
        insertNFTEvents(dbData),
        // Insert names
        insertNames(dbData),
        // Insert zonefiles
        insertZoneFiles(dbData),
        // Insert smart_contracts
        insertSmartContracts(dbData),
        // Insert namespaces
        insertNamespaces(dbData),
        // Insert stx_lock_events
        insertStxLockEvents(dbData),
        // Insert miner_rewards
        insertMinerRewards(dbData),
        // Insert pox2_events
        insertPox2Events(dbData),
        // Insert pox3_events
        insertPox3Events(dbData),
        // Insert pox4_events
        insertPox4Events(dbData),
      ]);

      next();
    },
  });
};

const transformDataToJSON = () => {
  return new Transform({
    objectMode: true,
    transform: (data, _encoding, callback) => {
      callback(null, JSON.parse(data.payload));
    },
  });
};

export const processNewBlockEvents = async (db: PgWriteStore, dataset: DatasetStore, ids?: any) => {
  logger.info({ component: 'event-replay' }, 'NEW_BLOCK events process started');

  const payload = await dataset.newBlockEventsPayloadStream(ids);
  const toJSON = transformDataToJSON();
  const insertBatchData = populateBatchInserters(db);

  await pipeline(
    Readable.from(payload),
    toJSON,
    insertBatchData.on('finish', async () => {
      for (const batchInserter of batchInserters) {
        await batchInserter.flush();
      }
    })
  );
};
