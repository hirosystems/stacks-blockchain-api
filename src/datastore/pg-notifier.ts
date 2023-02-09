import * as postgres from 'postgres';
import { logError, logger } from '../helpers';
import { DbConfigState } from './common';
import { connectPostgres, PgServer, PgSqlClient } from './connection';

type PgTxNotificationPayload = {
  txId: string;
};

type PgBlockNotificationPayload = {
  blockHash: string;
};

type PgMicroblockNotificationPayload = {
  microblockHash: string;
};

type PgNftEventNotificationPayload = {
  txId: string;
  eventIndex: number;
};

type PgAddressNotificationPayload = {
  address: string;
  blockHeight: number;
};

type PgTokenMetadataNotificationPayload = {
  queueId: number;
};

type PgNameNotificationPayload = {
  nameInfo: string;
};

type PgSmartContractNotificationPayload = {
  contractId: string;
};

type PgSmartContractLogNotificationPayload = {
  txId: string;
  eventIndex: number;
};

type PgTokensNotificationPayload = {
  contractID: string;
};

export type PgConfigStateNotificationPayload = DbConfigState;

/**
 * API notifications to be sent via Postgres `NOTIFY` queries.
 */
type PgNotification =
  | { type: 'blockUpdate'; payload: PgBlockNotificationPayload }
  | { type: 'microblockUpdate'; payload: PgMicroblockNotificationPayload }
  | { type: 'txUpdate'; payload: PgTxNotificationPayload }
  | { type: 'nftEventUpdate'; payload: PgNftEventNotificationPayload }
  | { type: 'addressUpdate'; payload: PgAddressNotificationPayload }
  | { type: 'nameUpdate'; payload: PgNameNotificationPayload }
  | { type: 'tokenMetadataUpdateQueued'; payload: PgTokenMetadataNotificationPayload }
  | { type: 'tokensUpdate'; payload: PgTokensNotificationPayload }
  | { type: 'smartContractUpdate'; payload: PgSmartContractNotificationPayload }
  | { type: 'smartContractLogUpdate'; payload: PgSmartContractLogNotificationPayload }
  | { type: 'configStateUpdate'; payload: PgConfigStateNotificationPayload };

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

  public async sendSmartContract(payload: PgSmartContractNotificationPayload) {
    await this.notify({ type: 'smartContractUpdate', payload: payload });
  }

  public async sendSmartContractLog(payload: PgSmartContractLogNotificationPayload) {
    await this.notify({ type: 'smartContractLogUpdate', payload: payload });
  }

  public async sendTokenMetadata(payload: PgTokenMetadataNotificationPayload) {
    await this.notify({ type: 'tokenMetadataUpdateQueued', payload: payload });
  }

  public async sendTokens(payload: PgTokensNotificationPayload) {
    await this.notify({ type: 'tokensUpdate', payload: payload });
  }

  public async sendConfigState(payload: PgConfigStateNotificationPayload) {
    await this.notify({ type: 'configStateUpdate', payload });
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
