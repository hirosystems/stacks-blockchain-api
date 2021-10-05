import { ClientConfig } from 'pg';
import createPostgresSubscriber, { Subscriber } from 'pg-listen';
import { logError } from '../helpers';
import { DbTokenMetadataQueueEntry } from './common';

export type PgTxNotificationPayload = {
  txId: string;
};

export type PgBlockNotificationPayload = {
  blockHash: string;
  microblocksAccepted: string[];
  microblocksStreamed: string[];
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

export type PgNotificationPayload =
  | PgBlockNotificationPayload
  | PgMicroblockNotificationPayload
  | PgTxNotificationPayload
  | PgAddressNotificationPayload
  | PgTokenMetadataNotificationPayload
  | PgNameNotificationPayload
  | PgTokensNotificationPayload;

export type PgNotification = {
  type: string;
  payload: PgNotificationPayload;
};

export type PgNotificationCallback = (notification: PgNotification) => void;

/**
 * Creates and connects to a channel between the API and the Postgres DB to receive table update notifications
 * using LISTEN/NOTIFY messages.
 * https://www.postgresql.org/docs/12/sql-notify.html
 */
export class PgNotifier {
  readonly pgChannelName: string = 'pg-notifier';
  subscriber: Subscriber;

  constructor(clientConfig: ClientConfig) {
    this.subscriber = createPostgresSubscriber(clientConfig);
  }

  public async connect(eventCallback: PgNotificationCallback) {
    this.subscriber.notifications.on(this.pgChannelName, message =>
      eventCallback(message.notification)
    );
    this.subscriber.events.on('error', error => logError('Fatal PgNotifier error', error));
    await this.subscriber.connect();
    await this.subscriber.listenTo(this.pgChannelName);
  }

  public sendBlock(payload: PgBlockNotificationPayload) {
    this.notify({ type: 'blockUpdate', payload: payload });
  }

  public sendMicroblock(payload: PgMicroblockNotificationPayload) {
    this.notify({ type: 'microblockUpdate', payload: payload });
  }

  public sendTx(payload: PgTxNotificationPayload) {
    this.notify({ type: 'txUpdate', payload: payload });
  }

  public sendAddress(payload: PgAddressNotificationPayload) {
    this.notify({ type: 'addressUpdate', payload: payload });
  }

  public sendName(payload: PgNameNotificationPayload) {
    this.notify({ type: 'nameUpdate', payload: payload });
  }

  public sendTokenMetadata(payload: PgTokenMetadataNotificationPayload) {
    this.notify({ type: 'tokenMetadataUpdateQueued', payload: payload });
  }

  public sendTokens(payload: PgTokensNotificationPayload) {
    this.notify({ type: 'tokensUpdate', payload: payload });
  }

  public async close() {
    await this.subscriber.unlisten(this.pgChannelName);
    await this.subscriber.close();
  }

  private notify(notification: PgNotification) {
    void this.subscriber
      .notify(this.pgChannelName, { notification: notification })
      .catch(error =>
        logError(`Error sending PgNotifier notification of type: ${notification.type}`, error)
      );
  }
}
