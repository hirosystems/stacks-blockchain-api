import { SERVER_VERSION } from '@hirosystems/api-toolkit';
import { logger as defaultLogger } from '@hirosystems/api-toolkit';
import { StacksEventStream, StacksEventStreamType } from '@hirosystems/salt-n-pepper-client';
import { EventEmitter } from 'node:events';
import { EventStreamServer } from './event-server';
import { PgWriteStore } from '../datastore/pg-write-store';

export class SnpEventStreamHandler {
  db: PgWriteStore;
  eventServer: EventStreamServer;
  logger = defaultLogger.child({ name: 'SnpEventStreamHandler' });
  snpClientStream: StacksEventStream;
  redisUrl: string;
  redisStreamPrefix: string | undefined;

  readonly events = new EventEmitter<{
    processedMessage: [{ msgId: string }];
  }>();

  constructor(opts: { db: PgWriteStore; eventServer: EventStreamServer; lastMessageId: string }) {
    this.db = opts.db;
    this.eventServer = opts.eventServer;

    this.redisUrl = process.env.SNP_REDIS_URL as string;
    if (!this.redisUrl) {
      throw new Error('SNP_REDIS_URL environment variable is not set');
    }

    this.redisStreamPrefix = process.env.SNP_REDIS_STREAM_KEY_PREFIX;

    this.logger.info(`SNP streaming enabled, lastMsgId: ${opts.lastMessageId}`);

    const appName = `stacks-blockchain-api ${SERVER_VERSION.tag} (${SERVER_VERSION.branch}:${SERVER_VERSION.commit})`;

    this.snpClientStream = new StacksEventStream({
      redisUrl: this.redisUrl,
      redisStreamPrefix: this.redisStreamPrefix,
      eventStreamType: StacksEventStreamType.chainEvents,
      lastMessageId: opts.lastMessageId,
      appName,
    });
  }

  async start() {
    this.logger.info(`Connecting to SNP event stream at ${this.redisUrl} ...`);
    await this.snpClientStream.connect({ waitForReady: true });
    this.snpClientStream.start(async (messageId, timestamp, path, body) => {
      return this.handleMsg(messageId, timestamp, path, body);
    });
  }

  async handleMsg(messageId: string, timestamp: string, path: string, body: any) {
    this.logger.debug(`Received SNP stream event ${path}, msgId: ${messageId}`);

    const response = await this.eventServer.fastifyInstance.inject({
      method: 'POST',
      url: path,
      payload: body,
    });

    if (response.statusCode < 200 || response.statusCode > 299) {
      const errorMessage = `Failed to process SNP message ${messageId} at path ${path}, status: ${response.statusCode}, body: ${response.body}`;
      this.logger.error(errorMessage);
      throw new Error(errorMessage);
    }

    await this.db.updateLastIngestedSnpRedisMsgId(this.db.sql, messageId);

    this.events.emit('processedMessage', { msgId: messageId });
  }

  async stop(): Promise<void> {
    await this.snpClientStream.stop();
  }
}
