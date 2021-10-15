import * as inspector from 'inspector';
import * as stream from 'stream';
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
export async function beginCpuProfiling(): Promise<{ stop: () => Promise<CpuProfileResult> }> {
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

  // fs.writeFileSync('./profile.cpuprofile', JSON.stringify(profile));

  const stop = async () => {
    try {
      logger.info(`CPU profiling stopping...`);
      return await new Promise<CpuProfileResult>((resolve, reject) =>
        session.post('Profiler.stop', (error, profileResult) =>
          error ? reject(error) : resolve(profileResult.profile)
        )
      );
    } finally {
      session.disconnect();
    }
  };

  return { stop };
}

/**
 * Connects and enables a new `inspector` session, then starts an internal v8 Heap profiling process.
 * @param outputStream - An output stream that heap snapshot chunks are written to.
 * The result stream can be used to create a `.heapsnapshot` file.
 * Use Chrome's 'DevTools for Node' (under chrome://inspect) to visualize the `.heapsnapshot` file.
 * @returns A function to stop the profiling.
 */
export function beginHeapProfiling(outputStream: stream.Writable): { stop: () => Promise<void> } {
  const session = new inspector.Session();
  session.connect();
  const listener = (message: { params: { chunk: string } }) => {
    outputStream.write(message.params.chunk, error => {
      if (error) {
        logger.error(`Error writing heap profile chunk to output stream: ${error.message}`, error);
      }
    });
  };
  session.on('HeapProfiler.addHeapSnapshotChunk', listener);

  const stop = async () => {
    try {
      return await new Promise<void>((resolve, reject) => {
        logger.info(`Heap profiling stopping...`);
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
    }
  };

  return { stop };
}

export async function startProfilerServer() {
  const serverPort = parsePort(process.env['STACKS_PROFILER_PORT']);
  const app = addAsync(express());

  app.getAsync('/profile/cpu', async (req, res) => {
    const durationParam = req.query['duration'];
    const seconds = parseInt(durationParam as string);
    if (!Number.isInteger(seconds) || seconds < 1) {
      res.status(400).json({ error: `Invalid 'duration' query parameter "${durationParam}"` });
      return;
    }
    const cpuProfiler = await beginCpuProfiling();
    const filename = `cpu_${Math.round(Date.now() / 1000)}_${seconds}-seconds.cpuprofile`;
    res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.flushHeaders();
    await timeout(seconds * 1000);
    const result = await cpuProfiler.stop();
    res.json(result);
  });

  app.getAsync('/profile/heap', async (req, res) => {
    const durationParam = req.query['duration'];
    const seconds = parseInt(durationParam as string);
    if (!Number.isInteger(seconds) || seconds < 1) {
      res.status(400).json({ error: `Invalid 'duration' query parameter "${durationParam}"` });
      return;
    }
    const heapProfiler = beginHeapProfiling(res);
    const filename = `heap_${Math.round(Date.now() / 1000)}_${seconds}-seconds.heapsnapshot`;
    res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.flushHeaders();
    await timeout(seconds * 1000);
    await heapProfiler.stop();
    res.end();
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
