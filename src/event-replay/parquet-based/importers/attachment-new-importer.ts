/* eslint-disable  @typescript-eslint/no-non-null-assertion */

import { PgWriteStore } from '../../../datastore/pg-write-store';
import { parseAttachmentMessage } from '../../../event-stream/event-server';
import { logger } from '../../../logger';
import { CoreNodeAttachmentMessage } from '../../../event-stream/core-node-message';
import { DataStoreAttachmentSubdomainData, DataStoreBnsBlockData } from '../../../datastore/common';
import { DatasetStore } from '../dataset/store';
import { I32_MAX } from '../../../helpers';

export const processAttachmentNewEvents = async (db: PgWriteStore, dataset: DatasetStore) => {
  logger.info({ component: 'event-replay' }, 'ATTACHMENTS_NEW events process started');

  const attachmentsNewEvents = await dataset.attachmentsNewEvents();
  const ary: DataStoreAttachmentSubdomainData[] = [];

  for await (const event of attachmentsNewEvents) {
    const blockData: DataStoreBnsBlockData = {
      index_block_hash: '',
      parent_index_block_hash: '',
      microblock_hash: '',
      microblock_sequence: I32_MAX,
      microblock_canonical: true,
    };
    const dataStore: DataStoreAttachmentSubdomainData = {};

    const attachmentMsg: CoreNodeAttachmentMessage[] = JSON.parse(event.payload);
    const attachments = parseAttachmentMessage(attachmentMsg);
    dataStore.subdomains = attachments.subdomainObj.dbBnsSubdomain;

    blockData.index_block_hash = attachments.subdomainObj.attachmentData.indexBlockHash;
    dataStore.blockData = blockData;

    dataStore.attachment = attachments.subdomainObj.attachmentData;

    ary.push(dataStore);
  }

  const blockHeights = [];
  for (const el of ary) {
    if (el.subdomains!.length !== 0) {
      blockHeights.push(el.attachment!.blockHeight);
    }
  }
  // get events from block heights
  const blockEvents = await dataset.getNewBlockEventsInBlockHeights(blockHeights);

  for (const event of blockEvents) {
    for (const ds of ary) {
      if (ds.blockData?.index_block_hash === event.index_block_hash) {
        const txs = JSON.parse(event.payload).transactions;
        for (const tx of txs) {
          if (ds.attachment!.txId === tx.txid) {
            ds.blockData!.microblock_hash = tx.microblock_hash || '';
            ds.blockData!.microblock_sequence = tx.microblock_sequence || I32_MAX;
          }
        }

        ds.blockData!.index_block_hash = event.index_block_hash;
        ds.blockData!.parent_index_block_hash = event.parent_index_block_hash;
      }
    }
  }

  await db.updateBatchSubdomainsEventReplay(db.sql, ary);
};
