import { StacksEventStream, StacksEventStreamType } from 'salt-and-pepper-client';
import { EventMessageHandler, newEventMessageHandler } from './event-message-handler';
import { PgWriteStore } from '../datastore/pg-write-store';
import { ChainID } from '@stacks/common';
import {
  CoreNodeAttachmentMessage,
  CoreNodeBlockMessage,
  CoreNodeBurnBlockMessage,
  CoreNodeDropMempoolTxMessage,
  CoreNodeMicroblockMessage,
} from './core-node-message';
import { handleBnsImport } from '../import-v1';
import { logger } from 'src/logger';

export async function startEventStream(opts: {
  datastore: PgWriteStore;
  chainId: ChainID;
  messageHandler?: EventMessageHandler;
}) {
  const db = opts.datastore;
  const messageHandler = opts.messageHandler ?? newEventMessageHandler();

  const eventStream = new StacksEventStream({
    redisUrl: process.env['REDIS_URL'],
    eventStreamType: StacksEventStreamType.all,
  });
  await eventStream.connect({ waitForReady: true });
  eventStream.start(async (messageId, timestamp, path, body) => {
    logger.info(`${path}: received Stacks stream event`);
    switch (path) {
      case '/new_block': {
        const blockMessage = body as CoreNodeBlockMessage;
        await messageHandler.handleBlockMessage(opts.chainId, blockMessage, db);
        if (blockMessage.block_height === 1) {
          await handleBnsImport(db);
        }
        await messageHandler.handleRawEventRequest(path, body, db);
        break;
      }

      case '/new_burn_block': {
        const msg = body as CoreNodeBurnBlockMessage;
        await messageHandler.handleBurnBlock(msg, db);
        await messageHandler.handleRawEventRequest(path, body, db);
        break;
      }

      case '/new_mempool_tx': {
        const rawTxs = body as string[];
        await messageHandler.handleMempoolTxs(rawTxs, db);
        await messageHandler.handleRawEventRequest(path, body, db);
        break;
      }

      case '/drop_mempool_tx': {
        const msg = body as CoreNodeDropMempoolTxMessage;
        await messageHandler.handleDroppedMempoolTxs(msg, db);
        await messageHandler.handleRawEventRequest(path, body, db);
        break;
      }

      case '/attachments/new': {
        const msg = body as CoreNodeAttachmentMessage[];
        await messageHandler.handleNewAttachment(msg, db);
        await messageHandler.handleRawEventRequest(path, body, db);
        break;
      }

      case '/new_microblocks': {
        const msg = body as CoreNodeMicroblockMessage;
        await messageHandler.handleMicroblockMessage(opts.chainId, msg, db);
        await messageHandler.handleRawEventRequest(path, body, db);
        break;
      }

      default:
        logger.warn(`Unhandled stacks stream event: ${path}`);
        break;
    }
  });

  return eventStream;
}
