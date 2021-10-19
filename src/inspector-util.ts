import * as inspector from 'inspector';
import * as stream from 'stream';
import { once } from 'events';
import { createServer, Server } from 'http';
import * as express from 'express';
import { addAsync } from '@awaitjs/express';
import { logError, logger, parsePort, timeout } from './helpers';
import { Socket } from 'net';

type CpuProfileResult = inspector.Profiler.Profile;

interface ProfilerInstance<TStartResult = unknown, TStopResult = unknown> {
  start: () => Promise<TStartResult>;
  stop: () => Promise<TStopResult>;
  session: inspector.Session;
}

function ignoreInspectorNotConnected(reason: unknown) {
  const ERR_INSPECTOR_NOT_CONNECTED = 'ERR_INSPECTOR_NOT_CONNECTED';
  const isNodeError = (r: unknown): r is NodeJS.ErrnoException => {
    return !!(r as NodeJS.ErrnoException).code;
  };
  if (isNodeError(reason)) {
    if (reason.code === ERR_INSPECTOR_NOT_CONNECTED) {
      return;
    }
  }
  throw reason;
}

/**
 * Connects and enables a new `inspector` session, then starts an internal v8 CPU profiling process.
 * @returns A function to stop the profiling, and return the CPU profile result object.
 * The result object can be used to create a `.cpuprofile` file using JSON.stringify.
 * Use VSCode or Chrome's 'DevTools for Node' (under chrome://inspect) to visualize the `.cpuprofile` file.
 */
export function initCpuProfiling(): ProfilerInstance<void, CpuProfileResult> {
  const session = new inspector.Session();
  session.connect();
  const start = async () => {
    try {
      logger.info(`[CpuProfiler] Enabling profiling...`);
      await new Promise<void>((resolve, reject) => {
        // TODO: test throwing a sync error here and see propagation behavior
        session.post('Profiler.enable', error => {
          if (error) {
            logError(`[CpuProfiler] Error enabling profiling: ${error}`, error);
            reject(error);
          } else {
            logger.info(`[CpuProfiler] Profiling enabled`);
            resolve();
          }
        });
      });
      logger.info(`[CpuProfiler] Profiling starting...`);
      await new Promise<void>((resolve, reject) =>
        session.post('Profiler.start', error => {
          if (error) {
            logError(`[CpuProfiler] Error starting profiling: ${error}`, error);
            reject(error);
          } else {
            logger.info(`[CpuProfiler] Profiling started`);
            resolve();
          }
        })
      );
    } catch (error) {
      session.disconnect();
      throw error;
    }
  };

  const stop = async () => {
    try {
      logger.info(`[CpuProfiler] Profiling stopping...`);
      const result = await new Promise<CpuProfileResult>((resolve, reject) =>
        session.post('Profiler.stop', (error, profileResult) => {
          if (error) {
            logError(`[CpuProfiler] Error stopping profiling: ${error}`, error);
            reject(error);
          } else {
            logger.info(`[CpuProfiler] Profiling stopped`);
            resolve(profileResult.profile);
          }
        })
      );
      logger.info(`[CpuProfiler] Disabling profiling...`);
      await new Promise<void>((resolve, reject) =>
        session.post('Profiler.disable', error => {
          if (error) {
            logError(`[CpuProfiler] Error disabling profiling: ${error}`, error);
            reject(error);
          } else {
            logger.info(`[CpuProfiler] Profiling disabled`);
            resolve();
          }
        })
      );
      return result;
    } finally {
      session.disconnect();
      session.removeAllListeners();
    }
  };

  return { start, stop, session };
}

/**
 * Connects and enables a new `inspector` session, then creates an internal v8 Heap profiler snapshot.
 * @param outputStream - An output stream that heap snapshot chunks are written to.
 * The result stream can be used to create a `.heapsnapshot` file.
 * Use Chrome's 'DevTools for Node' (under chrome://inspect) to visualize the `.heapsnapshot` file.
 */
export function initHeapSnapshot(
  outputStream: stream.Writable
): {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  session: inspector.Session;
} {
  const session = new inspector.Session();
  session.connect();
  const start = async () => {
    try {
      session.on('HeapProfiler.addHeapSnapshotChunk', message => {
        // Note: this doesn't handle stream backpressure, but we don't have control over the
        // `HeapProfiler.addHeapSnapshotChunk` callback in order to use something like piping.
        // So on a slow `outputStream` (usually an http connection response), this can cause OOM.
        logger.info(
          `[HeapProfiler] Writing heap snapshot chunk of size ${message.params.chunk.length}`
        );
        outputStream.write(message.params.chunk, error => {
          if (error) {
            logger.error(
              `[HeapProfiler] Error writing heap profile chunk to output stream: ${error.message}`,
              error
            );
          }
        });
      });
      await new Promise<void>((resolve, reject) => {
        logger.info(`[HeapProfiler] Taking snapshot...`);
        session.post('HeapProfiler.takeHeapSnapshot', undefined, (error: Error | null) => {
          if (error) {
            logError(`[HeapProfiler] Error taking snapshot: ${error}`, error);
            reject(error);
          } else {
            logger.info(`[HeapProfiler] Taking snapshot completed...`);
            resolve();
          }
        });
      });
    } catch (error) {
      session.disconnect();
      throw error;
    }
  };

  const stop = async () => {
    session.disconnect();
    session.removeAllListeners();
    return Promise.resolve();
  };

  return { start, stop, session };
}

export async function startProfilerServer(
  httpServerPort?: number | string
): Promise<{
  server: Server;
  address: string;
  close: () => Promise<void>;
}> {
  let serverPort: number | undefined = undefined;
  if (httpServerPort !== undefined) {
    serverPort = parsePort(httpServerPort);
  }
  const app = addAsync(express());

  let existingSession: { instance: ProfilerInstance; response: express.Response } | undefined;

  app.getAsync('/profile/cpu', async (req, res) => {
    if (existingSession) {
      res.status(409).json({ error: 'Profile session already in progress' });
      return;
    }
    const durationParam = req.query['duration'];
    const seconds = Number.parseFloat(durationParam as string);
    if (!Number.isFinite(seconds) || seconds < 0) {
      res.status(400).json({ error: `Invalid 'duration' query parameter "${durationParam}"` });
      return;
    }
    const cpuProfiler = initCpuProfiling();
    existingSession = { instance: cpuProfiler, response: res };
    try {
      const filename = `cpu_${Math.round(Date.now() / 1000)}_${seconds}-seconds.cpuprofile`;
      res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.flushHeaders();
      await cpuProfiler.start();
      await Promise.race([timeout(seconds * 1000), once(res, 'close')]);
      if (res.writableEnded || res.destroyed) {
        // session was cancelled
        return;
      }
      const result = await cpuProfiler.stop();
      res.end(JSON.stringify(result));
    } finally {
      await existingSession.instance.stop().catch(ignoreInspectorNotConnected);
      existingSession = undefined;
    }
  });

  app.getAsync('/profile/heap', async (req, res) => {
    if (existingSession) {
      res.status(409).json({ error: 'Profile session already in progress' });
      return;
    }
    const heapProfiler = initHeapSnapshot(res);
    existingSession = { instance: heapProfiler, response: res };
    try {
      const filename = `heap_${Math.round(Date.now() / 1000)}.heapsnapshot`;
      res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.flushHeaders();
      // Taking a heap snapshot (with current implementation) is a one-shot process ran to get the
      // applications current heap memory usage, rather than something done over time. So start and
      // stop without waiting.
      await heapProfiler.start();
      await heapProfiler.stop();
      res.end();
    } finally {
      await existingSession.instance.stop().catch(ignoreInspectorNotConnected);
      existingSession = undefined;
    }
  });

  app.getAsync('/profile/cancel', async (req, res) => {
    if (!existingSession) {
      res.status(409).json({ error: 'No existing profile session is exists to cancel' });
      return;
    }
    const session = existingSession;
    await session.instance.stop().catch(ignoreInspectorNotConnected);
    session.response.destroy();
    existingSession = undefined;
    await Promise.resolve();
    res.json({ ok: 'existing profile session stopped' });
  });

  const server = createServer(app);

  const serverSockets = new Set<Socket>();
  server.on('connection', socket => {
    serverSockets.add(socket);
    socket.once('close', () => {
      serverSockets.delete(socket);
    });
  });

  await new Promise<void>((resolve, reject) => {
    try {
      server.once('error', error => {
        reject(error);
      });
      server.listen(serverPort, '0.0.0.0', () => {
        resolve();
      });
    } catch (error) {
      reject(error);
    }
  });

  const addr = server.address();
  if (addr === null) {
    throw new Error('server missing address');
  }
  const addrStr = typeof addr === 'string' ? addr : `${addr.address}:${addr.port}`;
  logger.info(`Started profiler server on: http://${addrStr}`);

  const closeServer = async () => {
    const closePromise = new Promise<void>((resolve, reject) => {
      if (!server.listening) {
        // Server already closed (can happen when server is shared between cluster workers)
        return resolve();
      }
      server.close(error => (error ? reject(error) : resolve()));
    });
    for (const socket of serverSockets) {
      socket.destroy();
    }
    await closePromise;
  };

  return { server, address: addrStr, close: closeServer };
}
