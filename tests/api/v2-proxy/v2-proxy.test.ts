import supertest from 'supertest';
import * as http from 'node:http';
import { AddressInfo } from 'node:net';
import { ApiServer, startApiServer } from '../../../src/api/init.ts';
import { PgWriteStore } from '../../../src/datastore/pg-write-store.ts';
import { migrate } from '../../test-helpers.ts';
import { ENV } from '../../../src/env.ts';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { STACKS_MAINNET } from '@stacks/network';

interface ReceivedRequest {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

/** A fake Stacks node that records every request and answers with the configured response. */
async function startFakeNode() {
  const received: ReceivedRequest[] = [];
  const state = {
    status: 200,
    headers: { 'Content-Type': 'application/json' } as Record<string, string>,
    body: '{}' as string | Buffer,
  };
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', chunk => chunks.push(chunk as Buffer));
    req.on('end', () => {
      received.push({
        method: req.method ?? '',
        url: req.url ?? '',
        headers: req.headers,
        body: Buffer.concat(chunks),
      });
      res.writeHead(state.status, state.headers);
      res.end(state.body);
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  const close = () => new Promise<void>(resolve => server.close(() => resolve()));
  return { received, state, port, close };
}

describe('v2-proxy tests', () => {
  let db: PgWriteStore;
  let node: Awaited<ReturnType<typeof startFakeNode>>;
  let api: ApiServer;

  beforeEach(async () => {
    await migrate('up');
    db = await PgWriteStore.connect({
      usageName: 'tests',
      withNotifier: false,
      skipMigrations: true,
    });
    node = await startFakeNode();
    ENV.STACKS_CORE_PROXY_HOST = '127.0.0.1';
    ENV.STACKS_CORE_PROXY_PORT = node.port;
    api = await startApiServer({ datastore: db, chainId: STACKS_MAINNET.chainId });
  });

  afterEach(async () => {
    await api?.terminate();
    await node?.close();
    ENV.STACKS_CORE_PROXY_HOST = undefined;
    ENV.STACKS_CORE_PROXY_PORT = undefined;
    await db?.close();
    await migrate('down');
  });

  test('proxies GET requests to the node', async () => {
    node.state.body = JSON.stringify({ stacks_tip_height: 123 });
    const res = await supertest(api.server).get('/v2/info?foo=bar');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { stacks_tip_height: 123 });
    assert.equal(node.received.length, 1);
    assert.equal(node.received[0].method, 'GET');
    assert.equal(node.received[0].url, '/v2/info?foo=bar');
  });

  test('fee estimations pass through unmodified', async () => {
    const nodeResponse = {
      cost_scalar_change_by_byte: 0.00476837158203125,
      estimated_cost: {
        read_count: 19,
        read_length: 4814,
        runtime: 7175000,
        write_count: 2,
        write_length: 1020,
      },
      estimated_cost_scalar: 14,
      estimations: [
        { fee: 400, fee_rate: 1.2410714285714286 },
        { fee: 800, fee_rate: 8.958333333333332 },
        { fee: 1000, fee_rate: 10 },
      ],
    };
    // Exact bytes of the node's response, which must be returned verbatim.
    node.state.body = JSON.stringify(nodeResponse, null, 2);
    // Formatted so a proxy that parses and re-serializes the request body would fail the assertion.
    const request = JSON.stringify(
      {
        estimated_len: 350,
        transaction_payload:
          '021af942874ce525e87f21bbe8c121b12fac831d02f4086765742d696e666f0b7570646174652d696e666f00000000',
      },
      null,
      2
    );
    const res = await supertest(api.server)
      .post('/v2/fees/transaction')
      .set('Content-Type', 'application/json')
      .send(request);
    assert.equal(res.status, 200);
    assert.equal(res.text, node.state.body);
    assert.equal(node.received[0].body.toString(), request);
  });

  test('tx submissions are forwarded byte-for-byte to the node only', async () => {
    node.state.headers = { 'Content-Type': 'text/plain' };
    node.state.body = '"0xabcd"';
    // Larger than Fastify's default 1MB body limit.
    const rawTx = Buffer.alloc(2 * 1024 * 1024, 0xab);
    const res = await supertest(api.server)
      .post('/v2/transactions')
      .set('Content-Type', 'application/octet-stream')
      .send(rawTx);
    assert.equal(res.status, 200);
    assert.equal(res.text, '"0xabcd"');
    assert.equal(node.received.length, 1);
    assert.equal(node.received[0].headers['content-type'], 'application/octet-stream');
    assert.ok(node.received[0].body.equals(rawTx));
  });

  test('node error responses pass through', async () => {
    node.state.status = 400;
    node.state.body = JSON.stringify({ error: 'transaction rejected', reason: 'BadNonce' });
    const res = await supertest(api.server)
      .post('/v2/transactions')
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.from('0011', 'hex'));
    assert.equal(res.status, 400);
    assert.deepEqual(res.body, { error: 'transaction rejected', reason: 'BadNonce' });
  });
});
