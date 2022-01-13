import { ClientConfig } from 'pg';
import createPostgresSubscriber, { Subscriber } from 'pg-listen';
import { logError } from '../helpers';
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
  private readonly pgChannelName: string = 'pg-notifier';
  private readonly clientConfig: ClientConfig;
  private eventCallback?: PgNotificationCallback;
  private subscriber?: Subscriber;

  constructor(clientConfig: ClientConfig) {
    this.clientConfig = clientConfig;
  }

  public async connect(eventCallback: PgNotificationCallback) {
    this.eventCallback = eventCallback;
    await this.doConnect();
  }

  async doConnect() {
    this.subscriber = createPostgresSubscriber(this.clientConfig);
    this.subscriber.notifications.on(this.pgChannelName, message => {
      if (this.eventCallback) {
        this.eventCallback(message.notification);
      }
    });
    this.subscriber.events.on('error', error => logError('Fatal PgNotifier error', error));
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
    await this.subscriber?.unlisten(this.pgChannelName);
    await this.subscriber?.close();
  }

  private async notify(notification: PgNotification) {
    if (this.subscriber) {
      await this.subscriber
        .notify(this.pgChannelName, { notification: notification })
        .catch(async error => {
          if (error instanceof Error && error.message.includes('not queryable')) {
            // The postgres client has lost the connection or has otherwise become corrupt. We will attempt to
            // reconnect so we can continue sending events.
            // There's no point in calling `unlisten` before closing the current client since it requires a query.
            await this.subscriber?.close();
            await this.doConnect();
            // Try again now.
            await this.subscriber?.notify(this.pgChannelName, { notification: notification });
          } else {
            logError(`Error sending PgNotifier notification of type: ${notification.type}`, error);
          }
        });
    }
  }
}
