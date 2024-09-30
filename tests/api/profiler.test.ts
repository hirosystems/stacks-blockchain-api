import * as http from 'http';
import * as supertest from 'supertest';

import { httpGetRequest, readHttpResponse } from '../../src/helpers';
import { startProfilerServer } from '../../src/inspector-util';

describe('profiler tests', () => {
  let profiler: { server: http.Server; address: string; close: () => Promise<void> };

  beforeAll(async () => {
    profiler = await startProfilerServer();
  });

  test('CPU profiler snapshot bad duration', async () => {
    const query1 = await supertest(profiler.server).get(`/profile/cpu?duration=-100`);
    expect(query1.status).toBe(400);
  });

  test('generate CPU profiler snapshot', async () => {
    const duration = 0.25; // 250 milliseconds
    const query1 = await supertest(profiler.server).get(`/profile/cpu?duration=${duration}`);
    expect(query1.status).toBe(200);
    expect(query1.type).toBe('application/json');
    let cpuProfileBody: any;
    // Ensure entire profile result was streamed/returned
    expect(() => {
      cpuProfileBody = JSON.parse(query1.text);
    }).not.toThrow();
    // Cursory check for the expected JSON format of a `.cpuprofile` file
    expect(cpuProfileBody).toEqual(
      expect.objectContaining({
        nodes: expect.any(Array),
        samples: expect.any(Array),
        timeDeltas: expect.any(Array),
        startTime: expect.any(Number),
        endTime: expect.any(Number),
      })
    );
  });

  test('cancel CPU profiler snapshot', async () => {
    const duration = 150; // 150 seconds
    // init a cpu profile request
    const url = `http://${profiler.address}/profile/cpu?duration=${duration}`;
    const [_req, res] = await httpGetRequest(url);
    // hold on to the promise for reading the request response
    const readResPromise = readHttpResponse(res);
    // perform a request to cancel the previous profile session
    const endQuery = await supertest(profiler.server).get(`/profile/cancel`);
    expect(endQuery.status).toBe(200);
    // ensure the initial request failed
    await expect(readResPromise).rejects.toBeTruthy();
  });

  afterAll(async () => {
    await profiler.close();
  });
});
