import { PgWriteStore } from '../datastore/pg-write-store';
import { cycleMigrations, runMigrations } from '../datastore/migrations';
import { WebSocketTransmitter } from '../api/routes/ws/web-socket-transmitter';
import { Server } from 'http';
import {
  ListenerType,
  WebSocketChannel,
  WebSocketPayload,
  WebSocketTopics,
} from '../api/routes/ws/web-socket-channel';

class TestChannel extends WebSocketChannel {
  connect(): void {
    //
  }
  close(callback?: ((err?: Error | undefined) => void) | undefined): void {
    //
  }
  send<P extends keyof WebSocketPayload>(
    payload: P,
    ...args: ListenerType<WebSocketPayload[P]>
  ): void {
    //
  }
  hasListeners<P extends keyof WebSocketTopics>(
    topic: P,
    ...args: ListenerType<WebSocketTopics[P]>
  ): boolean {
    return true;
  }
}

describe('ws transmitter', () => {
  let db: PgWriteStore;
  let transmitter: WebSocketTransmitter;

  beforeEach(async () => {
    process.env.PG_DATABASE = 'postgres';
    await cycleMigrations();
    db = await PgWriteStore.connect({ usageName: 'tests', skipMigrations: true });
  });

  test('handles pg exceptions gracefully', async () => {
    const fakeServer = new Server();
    transmitter = new WebSocketTransmitter(db, fakeServer);
    transmitter['channels'].push(new TestChannel(fakeServer));
    await db.close();
    await expect(transmitter['blockUpdate']('0xff')).resolves.not.toThrow();
    await expect(transmitter['microblockUpdate']('0xff')).resolves.not.toThrow();
    await expect(transmitter['txUpdate']('0xff')).resolves.not.toThrow();
    await expect(transmitter['nftEventUpdate']('0xff', 0)).resolves.not.toThrow();
    await expect(transmitter['addressUpdate']('0xff', 1)).resolves.not.toThrow();
    await expect(transmitter['bnsImportUpdate']()).resolves.not.toThrow();
  });

  afterEach(async () => {
    await db?.close();
    await runMigrations(undefined, 'down');
  });
});
