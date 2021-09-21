import { ClientConfig } from 'pg';
import createPostgresSubscriber, { Subscriber } from 'pg-listen';
import { logError } from '../helpers';
import { AddressTxUpdateInfo, DbTokenMetadataQueueEntry } from './common';

export type PgTxNotificationPayload = {
  txId: string;
};

export type PgBlockNotificationPayload = {
  blockHash: string;
  txIds: string[];
  microblocksAccepted: string[];
  microblocksStreamed: string[];
};

export type PgAddressNotificationPayload = {
  info: AddressTxUpdateInfo;
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
 * As
 */
export class PgNotifier {
  subscriber?: Subscriber;
  eventCallback?: PgNotificationCallback;

  constructor(clientConfig: ClientConfig) {
    this.subscriber = createPostgresSubscriber(clientConfig, {
      // JSON.stringify doesn't serialize BigInt natively yet.
      serialize: data =>
        JSON.stringify(data, (_, value) =>
          // eslint-disable-next-line @typescript-eslint/no-unsafe-return
          typeof value === 'bigint' ? `BIGINT::${value}` : value
        ),
      parse: serialized =>
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return
        JSON.parse(serialized, (_, value) => {
          if (typeof value === 'string' && value.startsWith('BIGINT::')) {
            return BigInt(value.substr(8));
          }
          // eslint-disable-next-line @typescript-eslint/no-unsafe-return
          return value;
        }),
    });
  }

  public async connect(eventCallback: PgNotificationCallback) {
    this.eventCallback = eventCallback;
    this.subscriber?.notifications.on('stacks-pg', message => eventCallback(message.notification));
    this.subscriber?.events.on('error', error => {
      logError('Fatal pg subscriber error:', error);
    });
    await this.subscriber?.connect();
    await this.subscriber?.listenTo('stacks-pg');
  }

  public async sendBlock(payload: PgBlockNotificationPayload) {
    await this.notify({ type: 'blockUpdate', payload: payload });
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
    await this.subscriber?.close();
  }

  private async notify(notification: PgNotification) {
    await this.subscriber?.notify('stacks-pg', { notification: notification });
  }
}
