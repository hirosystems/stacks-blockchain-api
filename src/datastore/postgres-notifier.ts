import { ClientConfig } from 'pg';
import createPostgresSubscriber, { Subscriber } from 'pg-listen';
import { logError, logger } from '../helpers';
import { DbTokenMetadataQueueEntry } from './common';

export type PgTxNotificationPayload = {
  txId: string;
};

export type PgBlockNotificationPayload = {
  blockHash: string;
};

export type PgMicroblockNotificationPayload = {
  microblockHash: string;
};

export type PgAddressNotificationPayload = {
  address: string;
  blockHeight: number;
};

export type PgTokenMetadataNotificationPayload = {
  entry: DbTokenMetadataQueueEntry;
};

export type PgNameNotificationPayload = {
  nameInfo: string;
};

export type PgTokensNotificationPayload = {
  contractID: string;
};

type PgNotificationPayload =
  | PgBlockNotificationPayload
  | PgMicroblockNotificationPayload
  | PgTxNotificationPayload
  | PgAddressNotificationPayload
  | PgTokenMetadataNotificationPayload
  | PgNameNotificationPayload
  | PgTokensNotificationPayload;

type PgNotification = {
  type: string;
  payload: PgNotificationPayload;
};

type PgNotificationCallback = (notification: PgNotification) => void;

/**
 * Creates and connects to a channel between the API and the Postgres DB to receive table update notifications
 * using LISTEN/NOTIFY messages.
 * https://www.postgresql.org/docs/12/sql-notify.html
 */
export class PgNotifier {
  readonly pgChannelName: string = 'stacks-api-pg-notifier';
  subscriber: Subscriber;

  constructor(clientConfig: ClientConfig) {
    this.subscriber = createPostgresSubscriber(clientConfig, {
      native: false,
      paranoidChecking: 30000, // 30s
      retryLimit: Infinity, // Keep trying until it works or the API shuts down
      retryTimeout: Infinity,
      retryInterval: attempt => {
        const retryMs = 1000;
        logger.info(`PgNotifier reconnection attempt ${attempt}, trying again in ${retryMs}ms`);
        return retryMs;
      },
    });
  }

  public async connect(eventCallback: PgNotificationCallback) {
    this.subscriber.notifications.on(this.pgChannelName, message =>
      eventCallback(message.notification)
    );
    this.subscriber.events.on('connected', () =>
      logger.info(`PgNotifier connected, listening on channel: ${this.pgChannelName}`)
    );
    this.subscriber.events.on('error', error => logError('PgNotifier fatal error', error));
    await this.subscriber.connect();
    await this.subscriber.listenTo(this.pgChannelName);
  }

  public async sendBlock(payload: PgBlockNotificationPayload) {
    await this.notify({ type: 'blockUpdate', payload: payload });
  }

  public async sendMicroblock(payload: PgMicroblockNotificationPayload) {
    await this.notify({ type: 'microblockUpdate', payload: payload });
  }

  public async sendTx(payload: PgTxNotificationPayload) {
    await this.notify({ type: 'txUpdate', payload: payload });
  }

  public async sendAddress(payload: PgAddressNotificationPayload) {
    await this.notify({ type: 'addressUpdate', payload: payload });
  }

  public async sendName(payload: PgNameNotificationPayload) {
    await this.notify({ type: 'nameUpdate', payload: payload });
  }

  public async sendTokenMetadata(payload: PgTokenMetadataNotificationPayload) {
    await this.notify({ type: 'tokenMetadataUpdateQueued', payload: payload });
  }

  public async sendTokens(payload: PgTokensNotificationPayload) {
    await this.notify({ type: 'tokensUpdate', payload: payload });
  }

  public async close() {
    logger.info(`PgNotifier closing channel: ${this.pgChannelName}`);
    await this.subscriber.unlisten(this.pgChannelName);
    await this.subscriber.close();
  }

  private async notify(notification: PgNotification) {
    await this.subscriber
      .notify(this.pgChannelName, { notification: notification })
      .catch(error =>
        logError(`PgNotifier error sending notification of type: ${notification.type}`, error)
      );
  }
}
