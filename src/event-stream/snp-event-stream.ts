import { parseBoolean, SERVER_VERSION } from '@hirosystems/api-toolkit';
import { logger as defaultLogger } from '@hirosystems/api-toolkit';
import { EventEmitter } from 'node:events';
import { EventStreamServer } from './event-server';
import { PgWriteStore } from '../datastore/pg-write-store';
import { StacksMessageStream } from '@stacks/node-publisher-client';
import { MessagePath } from '@stacks/node-publisher-client/dist/messages';

export class SnpEventStreamHandler {
  db: PgWriteStore;
  eventServer: EventStreamServer;
  logger = defaultLogger.child({ name: 'SnpEventStreamHandler' });
  snpClientStream: StacksMessageStream;
  redisUrl: string;
  redisStreamPrefix: string | undefined;

  readonly events = new EventEmitter<{
    processedMessage: [{ msgId: string }];
  }>();

  constructor(opts: { db: PgWriteStore; eventServer: EventStreamServer }) {
    this.db = opts.db;
    this.eventServer = opts.eventServer;

    this.redisUrl = process.env.SNP_REDIS_URL as string;
    if (!this.redisUrl) {
      throw new Error('SNP_REDIS_URL environment variable is not set');
    }

    this.redisStreamPrefix = process.env.SNP_REDIS_STREAM_KEY_PREFIX;

    const blocksOnly = process.env.SNP_BLOCKS_ONLY_STREAMING
      ? parseBoolean(process.env.SNP_BLOCKS_ONLY_STREAMING)
      : false;
    const selectedMessagePaths = blocksOnly
      ? [MessagePath.NewBlock, MessagePath.NewBurnBlock]
      : '*';
    this.logger.info(`SNP streaming enabled, blocksOnly: ${blocksOnly}`);

    const appName = `stacks-blockchain-api ${SERVER_VERSION.tag} (${SERVER_VERSION.branch}:${SERVER_VERSION.commit})`;

    this.snpClientStream = new StacksMessageStream({
      appName,
      redisUrl: this.redisUrl,
      redisStreamPrefix: this.redisStreamPrefix,
      options: {
        selectedMessagePaths,
      },
    });
  }

  async start() {
    this.logger.info(`Connecting to SNP event stream at ${this.redisUrl} ...`);
    await this.snpClientStream.connect({ waitForReady: true });
    this.snpClientStream.start(
      async () => {
        const chainTip = await this.db.getChainTip(this.db.sql);
        this.logger.info(
          `Starting SNP stream at position: ${chainTip.index_block_hash}@${chainTip.block_height}`
        );
        return {
          indexBlockHash: chainTip.index_block_hash,
          blockHeight: chainTip.block_height,
        };
      },
      async (id, timestamp, message) => {
        return this.handleMsg(id, timestamp, message.path, message.payload);
      }
    );
  }

  async handleMsg(messageId: string, _timestamp: string, path: string, body: any) {
    this.logger.debug(`Received SNP stream event ${path}, msgId: ${messageId}`);
    let response;

    try {
      response = await this.eventServer.fastifyInstance.inject({
        method: 'POST',
        url: path,
        payload: body,
      });
    } catch (error) {
      const errorMessage = `Failed to process SNP message ${messageId} at path ${path}: ${error}`;
      this.logger.error(error, errorMessage);
      throw new Error(errorMessage);
    }

    if (response?.statusCode < 200 || response?.statusCode > 299) {
      const errorMessage = `Failed to process SNP message ${messageId} at path ${path}, status: ${response.statusCode}, body: ${response.body}`;
      this.logger.error(errorMessage);
      throw new Error(errorMessage);
    }

    this.events.emit('processedMessage', { msgId: messageId });
  }

  async stop(): Promise<void> {
    await this.snpClientStream.stop();
  }
}
