import { Readable, Writable, Transform } from 'stream';
import { pipeline } from 'stream/promises';
import { PgWriteStore } from '../../../datastore/pg-write-store';
import { parseNewBlockMessage } from '../../../event-stream/event-server';
import { DbBlock, DbMicroblock, DbTx } from '../../../datastore/common';
import { logger } from '../../../logger';
import { TimeTracker } from '../helpers';
import { getApiConfiguredChainID, batchIterate } from '../../../helpers';
import { CoreNodeBlockMessage } from '../../../event-stream/core-node-message';
import { DatasetStore } from '../dataset/store';

const batchInserters: BatchInserter[] = [];

const chainID = getApiConfiguredChainID();

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
      logger.info('Flushing remaining data...');
      if (entryBuffer.length > 0) {
        await insertFn(entryBuffer);
        entryBuffer = [];
      }
    },
  };
}

const populateBatchInserters = async (db: PgWriteStore) => {
  const dbBlockBatchInserter = createBatchInserter<DbBlock>({
    batchSize: 100,
    insertFn: (entries) => {
      logger.info('Inserting blocks...');
      return db.insertBlockBatch(db.sql, entries);
    },
  });
  batchInserters.push(dbBlockBatchInserter);

  const dbMicroblockBatchInserter = createBatchInserter<DbMicroblock>({
    batchSize: 200,
    insertFn: (entries) => {
      logger.info('Inserting microblocks...');
      return db.insertMicroblock(db.sql, entries);
    },
  });
  batchInserters.push(dbMicroblockBatchInserter);

  const dbTxBatchInserter = createBatchInserter<DbTx>({
    batchSize: 1000,
    insertFn: (entries) => {
      logger.info('Inserting txs...');
      return db.insertTxBatch(db.sql, entries);
    },
  });
  batchInserters.push(dbTxBatchInserter);

  return new Writable({
    objectMode: true,
    write: async (data: CoreNodeBlockMessage, _encoding, next) => {

      let dbData;
      try {
        dbData = parseNewBlockMessage(chainID, data);
      } catch (err) {
        logger.error('Error when parsing new_block event');
        console.error(err);

        throw err;
      }

      const insertTxs = async (dbData: any) => {
        for (const entry of dbData.txs) {
          await dbTxBatchInserter.push([entry.tx]);
        }
      };

      await Promise.all([
        // Insert blocks
        dbBlockBatchInserter.push([dbData.block]),
        // Insert microblocks
        dbMicroblockBatchInserter.push(dbData.microblocks),
        // Insert Txs
        insertTxs(dbData)
      ]);

      next();
    }
  });
}

const transformDataToJSON = async () => {
  return new Transform({
    objectMode: true,
    transform: async (data, _encoding, callback) => {
      callback(null, JSON.parse(data.payload));
    }
  });
};

export const insertNewBlockEvents = async (db: PgWriteStore, dataset: DatasetStore, timeTracker: TimeTracker) => {
  logger.info(`Inserting NEW_BLOCK events to db...`);

  await timeTracker.track('insertNewBlockEvents', async () => {
    const payload = await dataset.newBlockEventsOrderedPayloadStream();
    const toJSON = await transformDataToJSON();
    const insertBatchData = await populateBatchInserters(db);

    await pipeline(
      Readable.from(payload),
      toJSON,
      insertBatchData
        .on('finish', async () => {
          for (const batchInserter of batchInserters) {
            await batchInserter.flush();
          }
        })
    )
  });
};
