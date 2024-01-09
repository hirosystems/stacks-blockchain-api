/* eslint-disable  @typescript-eslint/no-non-null-assertion */
/* eslint-disable  @typescript-eslint/no-unsafe-return */

import { Readable, Writable } from 'stream';
import { pipeline } from 'stream/promises';
import { PgWriteStore } from '../../../datastore/pg-write-store';
import { parseAttachment } from '../../../event-stream/event-server';
import { logger } from '../../../logger';
import { CoreNodeAttachmentMessage } from '../../../event-stream/core-node-message';
import { DataStoreAttachmentSubdomainData } from '../../../datastore/common';
import { DatasetStore } from '../dataset/store';
import { I32_MAX } from '../../../helpers';
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

const insertInBatch = (db: PgWriteStore, canonicalBlockHashes: any) => {
  const dbAttachmentEventBatchInserter = createBatchInserter<DataStoreAttachmentSubdomainData>({
    batchSize: 1,
    insertFn: async entries => {
      logger.debug({ component: 'event-replay' }, 'Inserting into subdomains table...');
      return await db.updateBatchSubdomains(db.sql, entries);
    },
  });
  batchInserters.push(dbAttachmentEventBatchInserter);
  return new Writable({
    objectMode: true,
    write: async (data, _encoding, next) => {
      const dataStoreAttachments: DataStoreAttachmentSubdomainData[] = [];
      const attachmentMsg: CoreNodeAttachmentMessage[] = JSON.parse(data.payload);
      const attachments = parseAttachment(attachmentMsg);

      for (const subdomain of attachments.subdomains) {
        const dataStoreAttachment: DataStoreAttachmentSubdomainData = {};
        const indexBlockHash = subdomain.index_block_hash!;
        const blockEntityData = canonicalBlockHashes[subdomain.block_height - 1];
        const parentIndexBlockHash =
          canonicalBlockHashes[subdomain.block_height - 2]['index_block_hash'];
        const microblocks = JSON.parse(blockEntityData['microblock']);

        const microblockIndex = microblocks.findIndex(
          (mb: any, index: any) => index > 0 && mb[1].includes(subdomain.tx_id)
        );

        // derive from entity hash index
        subdomain.tx_index = JSON.parse(blockEntityData['microblock'])
          .flatMap((m: any) => m[1])
          .findIndex((tx: any) => tx === subdomain.tx_id);

        const blockData = {
          index_block_hash: indexBlockHash,
          parent_index_block_hash: parentIndexBlockHash,
          microblock_hash: microblockIndex !== -1 ? microblocks[microblockIndex][0] : '',
          microblock_sequence: microblockIndex !== -1 ? microblockIndex - 1 : I32_MAX,
          microblock_canonical: true,
        };

        dataStoreAttachment.blockData = blockData;
        dataStoreAttachment.subdomains = attachments.subdomains;
        dataStoreAttachments.push(dataStoreAttachment);
      }

      await dbAttachmentEventBatchInserter.push(dataStoreAttachments);

      next();
    },
  });
};

export const processAttachmentNewEvents = async (db: PgWriteStore, dataset: DatasetStore) => {
  logger.info({ component: 'event-replay' }, 'ATTACHMENTS_NEW events process started');

  const canonicalEvents = await dataset.attachmentsCanonicalEvents();
  const canonicalBlockHashes: any = await dataset.canonicalBlockHashes();
  const insert = insertInBatch(db, canonicalBlockHashes);

  await pipeline(
    Readable.from(canonicalEvents),
    insert.on('finish', async () => {
      for (const batchInserter of batchInserters) {
        await batchInserter.flush();
      }
    })
  );
};
