import { Readable, Writable } from 'stream';
import { pipeline } from 'stream/promises';
import { PgWriteStore } from '../../../datastore/pg-write-store';
import { RawEventRequestInsertValues } from '../../../datastore/common';
import { logger } from '../../../logger';
import { DatasetStore } from '../dataset/store';
import { batchIterate } from '@hirosystems/api-toolkit';

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

const insertInBatch = (db: PgWriteStore) => {
  const dbRawEventBatchInserter = createBatchInserter<RawEventRequestInsertValues>({
    batchSize: 200,
    insertFn: async entries => {
      logger.debug(
        { component: 'event-replay' },
        'Inserting into event_observer_requests table...'
      );
      return await db.insertRawEventRequestBatch(db.sql, entries);
    },
  });
  batchInserters.push(dbRawEventBatchInserter);

  return new Writable({
    objectMode: true,
    write: async (data, _encoding, next) => {
      await dbRawEventBatchInserter.push([{ event_path: data.method, payload: data.payload }]);

      next();
    },
  });
};

export const processRawEvents = async (db: PgWriteStore, dataset: DatasetStore) => {
  logger.info({ component: 'event-replay' }, 'RAW events process started');

  const payload = await dataset.rawEvents();
  const insert = insertInBatch(db);

  await pipeline(
    Readable.from(payload),
    insert.on('finish', async () => {
      for (const batchInserter of batchInserters) {
        await batchInserter.flush();
      }
    })
  );
};

export const processRawEventsInParallel = async (
  db: PgWriteStore,
  dataset: DatasetStore,
  ids: any
) => {
  logger.info({ component: 'event-replay' }, 'RAW events parallel processing started');

  const payload = await dataset.rawEventsByIds(ids);
  const insert = insertInBatch(db);

  await pipeline(
    Readable.from(payload),
    insert.on('finish', async () => {
      for (const batchInserter of batchInserters) {
        await batchInserter.flush();
      }
    })
  );
};
