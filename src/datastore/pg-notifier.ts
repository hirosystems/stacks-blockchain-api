import * as postgres from 'postgres';
import { logError, logger } from '../helpers';
import { connectPostgres, PgServer, PgSqlClient } from './connection';

type PgNotificationType =
  | 'blockUpdate'
  | 'microblockUpdate'
  | 'txUpdate'
  | 'nftEventUpdate'
  | 'addressUpdate'
  | 'nameUpdate'
  | 'tokenMetadataUpdateQueued'
  | 'tokensUpdate'
  | 'bnsImportUpdate';

export type PgTxNotificationPayload = {
  txId: string;
};

export type PgBlockNotificationPayload = {
  blockHash: string;
};

export type PgMicroblockNotificationPayload = {
  microblockHash: string;
};

export type PgNftEventNotificationPayload = {
  txId: string;
  eventIndex: number;
};

export type PgAddressNotificationPayload = {
  address: string;
  blockHeight: number;
};

export type PgBnsImportNotificationPayload = {
  bnsNamesOnchainImported: boolean;
  bnsSubdomainsImported: boolean;
};

export type PgTokenMetadataNotificationPayload = {
  queueId: number;
};

export type PgNameNotificationPayload = {
  nameInfo: string;
};

export type PgTokensNotificationPayload = {
  contractID: string;
};

type PgNotificationPayload =
  | PgAddressNotificationPayload
  | PgBlockNotificationPayload
  | PgMicroblockNotificationPayload
  | PgNameNotificationPayload
  | PgNftEventNotificationPayload
  | PgTokenMetadataNotificationPayload
  | PgTokensNotificationPayload
  | PgTxNotificationPayload
  | PgBnsImportNotificationPayload;

type PgNotification = {
  type: PgNotificationType;
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
  readonly sql: PgSqlClient;
  listener?: postgres.ListenMeta;

  static async create(usageName: string) {
    const sql = await connectPostgres({ usageName: usageName, pgServer: PgServer.primary });
    return new PgNotifier(sql);
  }

  constructor(sql: PgSqlClient) {
    this.sql = sql;
  }

  public async connect(eventCallback: PgNotificationCallback) {
    try {
      this.listener = await this.sql.listen(
        this.pgChannelName,
        message => eventCallback(JSON.parse(message) as PgNotification),
        () => logger.info(`PgNotifier connected, listening on channel: ${this.pgChannelName}`)
      );
    } catch (error) {
      logError('PgNotifier fatal connection error', error);
      throw error;
    }
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

  public async sendNftEvent(payload: PgNftEventNotificationPayload) {
    await this.notify({ type: 'nftEventUpdate', payload: payload });
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

  public async sendBnsImport(payload: PgBnsImportNotificationPayload) {
    await this.notify({ type: 'bnsImportUpdate', payload });
  }

  public async close() {
    await this.listener
      ?.unlisten()
      .then(() => logger.info(`PgNotifier closed channel: ${this.pgChannelName}`));
    await this.sql.end();
  }

  private async notify(notification: PgNotification) {
    await this.sql
      .notify(this.pgChannelName, JSON.stringify(notification))
      .catch(error =>
        logError(`PgNotifier error sending notification of type: ${notification.type}`, error)
      );
  }
}
