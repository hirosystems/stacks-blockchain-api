import * as inspector from 'inspector';
import * as stream from 'stream';
import { once } from 'events';
import { createServer } from 'http';
import * as express from 'express';
import { addAsync, RouterWithAsync } from '@awaitjs/express';
import { logger, parsePort, timeout } from './helpers';
import { Socket } from 'net';

type CpuProfileResult = inspector.Profiler.Profile;

/**
 * Connects and enables a new `inspector` session, then starts an internal v8 CPU profiling process.
 * @returns A function to stop the profiling, and return the CPU profile result object.
 * The result object can be used to create a `.cpuprofile` file using JSON.stringify.
 * Use VSCode or Chrome's 'DevTools for Node' (under chrome://inspect) to visualize the `.cpuprofile` file.
 */
export async function beginCpuProfiling(): Promise<{
  stop: () => Promise<CpuProfileResult>;
  session: inspector.Session;
}> {
  const session = new inspector.Session();
  session.connect();

  try {
    logger.info(`CPU profiling enabling...`);
    await new Promise<void>((resolve, reject) =>
      session.post('Profiler.enable', error => (error ? reject(error) : resolve()))
    );
    logger.info(`CPU profiling starting...`);
    await new Promise<void>((resolve, reject) =>
      session.post('Profiler.start', error => (error ? reject(error) : resolve()))
    );
  } catch (error) {
    session.disconnect();
    throw error;
  }

  const stop = async () => {
    try {
      logger.info(`CPU profiling stopping...`);
      const result = await new Promise<CpuProfileResult>((resolve, reject) =>
        session.post('Profiler.stop', (error, profileResult) =>
          error ? reject(error) : resolve(profileResult.profile)
        )
      );
      await new Promise<void>((resolve, reject) =>
        session.post('Profiler.disable', error => (error ? reject(error) : resolve()))
      );
      return result;
    } finally {
      session.disconnect();
      session.removeAllListeners();
    }
  };

  return { stop, session };
}

/**
 * Connects and enables a new `inspector` session, then creates an internal v8 Heap profiler snapshot.
 * @param outputStream - An output stream that heap snapshot chunks are written to.
 * The result stream can be used to create a `.heapsnapshot` file.
 * Use Chrome's 'DevTools for Node' (under chrome://inspect) to visualize the `.heapsnapshot` file.
 */
export async function takeHeapSnapshot(outputStream: stream.Writable): Promise<void> {
  const session = new inspector.Session();
  session.connect();
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
          reject(error);
        } else {
          resolve();
        }
      });
    });
  } finally {
    session.disconnect();
    session.removeAllListeners();
  }
}

export async function startProfilerServer() {
  const serverPort = parsePort(process.env['STACKS_PROFILER_PORT']);
  const app = addAsync(express());

  let existingSession: { session: inspector.Session; res: express.Response } | undefined;

  app.getAsync('/profile/cpu', async (req, res) => {
    if (existingSession) {
      res.status(409).json({ error: 'Profile session already in progress' });
      return;
    }
    const durationParam = req.query['duration'];
    const seconds = parseInt(durationParam as string);
    if (!Number.isInteger(seconds) || seconds < 1) {
      res.status(400).json({ error: `Invalid 'duration' query parameter "${durationParam}"` });
      return;
    }
    const filename = `cpu_${Math.round(Date.now() / 1000)}_${seconds}-seconds.cpuprofile`;
    res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.flushHeaders();
    const cpuProfiler = await beginCpuProfiling();
    try {
      existingSession = { session: cpuProfiler.session, res };
      await Promise.race([timeout(seconds * 1000), once(res, 'close')]);
      if (res.writableEnded || res.destroyed) {
        // session was cancelled
        return;
      }
      const result = await cpuProfiler.stop();
      res.end(JSON.stringify(result));
    } finally {
      existingSession = undefined;
    }
  });

  app.getAsync('/profile/heap', async (req, res) => {
    if (existingSession) {
      res.status(409).json({ error: 'Profile session already in progress' });
      return;
    }
    const durationParam = req.query['duration'];
    const seconds = parseInt(durationParam as string);
    if (!Number.isInteger(seconds) || seconds < 1) {
      res.status(400).json({ error: `Invalid 'duration' query parameter "${durationParam}"` });
      return;
    }
    const filename = `heap_${Math.round(Date.now() / 1000)}_${seconds}-seconds.heapsnapshot`;
    res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.flushHeaders();
    await takeHeapSnapshot(res);
    res.end();
  });

  app.getAsync('/profile/cancel', async (req, res) => {
    if (!existingSession) {
      res.status(409).json({ error: 'No existing profile session is exists to cancel' });
      return;
    }
    existingSession.session.disconnect();
    existingSession.res.destroy();
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
      server.listen(serverPort, () => {
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

  return { close: closeServer };
}
