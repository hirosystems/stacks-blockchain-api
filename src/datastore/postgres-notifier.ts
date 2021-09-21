import { ClientConfig } from 'pg';
import createPostgresSubscriber, { Subscriber } from 'pg-listen';
import { isTestEnv, logError } from '../helpers';
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
    if (isTestEnv) {
      return;
    }
    this.subscriber = createPostgresSubscriber(clientConfig, {
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
    if (isTestEnv) {
      return;
    }
    this.subscriber?.notifications.on('stacks-pg', message => eventCallback(message.notification));
    this.subscriber?.events.on('error', error => {
      logError('Fatal pg subscriber error:', error);
    });
    await this.subscriber?.connect();
    await this.subscriber?.listenTo('stacks-pg');
  }

  public sendBlock(payload: PgBlockNotificationPayload) {
    this.notify({ type: 'blockUpdate', payload: payload });
  }

  public sendTx(payload: PgTxNotificationPayload) {
    this.notify({ type: 'txUpdate', payload: payload });
  }

  public sendAddress(payload: PgAddressNotificationPayload) {
    this.notify({ type: 'addressUpdate', payload: payload });
  }

  public sendName(payload: PgNameNotificationPayload) {
    this.notify({ type: 'nameUpdateUpdate', payload: payload });
  }

  public sendTokenMetadata(payload: PgTokenMetadataNotificationPayload) {
    this.notify({ type: 'tokenMetadataUpdateQueued', payload: payload });
  }

  public sendTokens(payload: PgTokensNotificationPayload) {
    this.notify({ type: 'tokensUpdate', payload: payload });
  }

  public async close() {
    await this.subscriber?.close();
  }

  private notify(notification: PgNotification) {
    if (isTestEnv && this.eventCallback) {
      this.eventCallback(notification);
    } else {
      this.subscriber?.notify('stacks-pg', { notification: notification });
    }
  }
}
