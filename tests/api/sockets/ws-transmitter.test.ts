import { PgWriteStore } from '../../../src/datastore/pg-write-store.ts';
import { WebSocketTransmitter } from '../../../src/api/routes/ws/web-socket-transmitter.ts';
import { Server } from 'http';
import {
  ListenerType,
  WebSocketChannel,
  WebSocketPayload,
  WebSocketTopics,
} from '../../../src/api/routes/ws/web-socket-channel.ts';
import { migrate } from '../../test-helpers.ts';
import assert from 'node:assert/strict';
import { describe, test, beforeEach, afterEach } from 'node:test';

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
    await migrate('up');
    db = await PgWriteStore.connect({ usageName: 'tests', skipMigrations: true });
  });

  afterEach(async () => {
    await db?.close();
    await migrate('down');
  });

  test('handles pg exceptions gracefully', async () => {
    const fakeServer = new Server();
    transmitter = new WebSocketTransmitter(db, fakeServer);
    transmitter['channels'].push(new TestChannel(fakeServer));
    await db.close();
    await assert.doesNotReject(transmitter['blockUpdate']('0xff'));
    await assert.doesNotReject(transmitter['microblockUpdate']('0xff'));
    await assert.doesNotReject(transmitter['txUpdate']('0xff'));
    await assert.doesNotReject(transmitter['nftEventUpdate']('0xff', 0));
    await assert.doesNotReject(transmitter['addressUpdate']('0xff', 1));
  });
});
