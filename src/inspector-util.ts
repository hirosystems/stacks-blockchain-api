import * as inspector from 'inspector';
import * as stream from 'stream';
import { once } from 'events';
import { createServer, Server } from 'http';
import Fastify from 'fastify';
import { parsePort, pipelineAsync } from './helpers';
import { Socket } from 'net';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { startProfiler, stopProfiler } from '@hirosystems/stacks-encoding-native-js';
import { logger } from './logger';
import { stopwatch, Stopwatch, timeout } from '@hirosystems/api-toolkit';

type CpuProfileResult = inspector.Profiler.Profile;

interface ProfilerInstance<TStopResult = void> {
  start: () => Promise<void>;
  stop: () => Promise<TStopResult>;
  dispose: () => Promise<void>;
  session: inspector.Session;
  sessionType: 'cpu' | 'memory';
  stopwatch: Stopwatch;
}

function isInspectorNotConnectedError(error: unknown): boolean {
  const ERR_INSPECTOR_NOT_CONNECTED = 'ERR_INSPECTOR_NOT_CONNECTED';
  const isNodeError = (r: unknown): r is NodeJS.ErrnoException => r instanceof Error && 'code' in r;
  return isNodeError(error) && error.code === ERR_INSPECTOR_NOT_CONNECTED;
}

/**
 * Connects and enables a new `inspector` session, then starts an internal v8 CPU profiling process.
 * @returns A function to stop the profiling, and return the CPU profile result object.
 * The result object can be used to create a `.cpuprofile` file using JSON.stringify.
 * Use VSCode or Chrome's 'DevTools for Node' (under chrome://inspect) to visualize the `.cpuprofile` file.
 * @param samplingInterval - Optionally set sampling interval in microseconds, default is 1000 microseconds.
 */
function initCpuProfiling(samplingInterval?: number): ProfilerInstance<CpuProfileResult> {
  const sessionStopwatch = stopwatch();
  const session = new inspector.Session();
  session.connect();
  logger.info(`[CpuProfiler] Connect session took ${sessionStopwatch.getElapsedAndRestart()}ms`);
  const start = async () => {
    const sw = stopwatch();
    logger.info(`[CpuProfiler] Enabling profiling...`);
    await new Promise<void>((resolve, reject) => {
      try {
        session.post('Profiler.enable', error => {
          if (error) {
            logger.error(error, '[CpuProfiler] Error enabling profiling');
            reject(error);
          } else {
            logger.info(`[CpuProfiler] Profiling enabled`);
            resolve();
          }
        });
      } catch (error) {
        logger.error(error, '[CpuProfiler] Error enabling profiling');
        reject(error);
      }
    });
    logger.info(`[CpuProfiler] Enable session took ${sw.getElapsedAndRestart()}ms`);

    if (samplingInterval !== undefined) {
      logger.info(`[CpuProfiler] Setting sampling interval to ${samplingInterval} microseconds`);
      await new Promise<void>((resolve, reject) => {
        try {
          session.post('Profiler.setSamplingInterval', { interval: samplingInterval }, error => {
            if (error) {
              logger.error(error, '[CpuProfiler] Error setting sampling interval');
              reject(error);
            } else {
              logger.info(`[CpuProfiler] Set sampling interval`);
              resolve();
            }
          });
        } catch (error) {
          logger.error(error, '[CpuProfiler] Error setting sampling interval');
          reject(error);
        }
      });
      logger.info(`[CpuProfiler] Set sampling interval took ${sw.getElapsedAndRestart()}ms`);
    }

    logger.info(`[CpuProfiler] Profiling starting...`);
    await new Promise<void>((resolve, reject) => {
      try {
        session.post('Profiler.start', error => {
          if (error) {
            logger.error(error, '[CpuProfiler] Error starting profiling');
            reject(error);
          } else {
            sessionStopwatch.restart();
            logger.info(`[CpuProfiler] Profiling started`);
            resolve();
          }
        });
      } catch (error) {
        logger.error(error, '[CpuProfiler] Error starting profiling');
        reject(error);
      }
    });
    logger.info(`[CpuProfiler] Start profiler took ${sw.getElapsedAndRestart()}ms`);
  };

  const stop = async () => {
    const sw = stopwatch();
    logger.info(`[CpuProfiler] Profiling stopping...`);
    try {
      return await new Promise<CpuProfileResult>((resolve, reject) => {
        try {
          session.post('Profiler.stop', (error, profileResult) => {
            if (error) {
              logger.error(error, '[CpuProfiler] Error stopping profiling');
              reject(error);
            } else {
              logger.info(`[CpuProfiler] Profiling stopped`);
              resolve(profileResult.profile);
            }
          });
        } catch (error) {
          reject(error);
        }
      });
    } finally {
      logger.info(`[CpuProfiler] Stop profiler took ${sw.getElapsedAndRestart()}ms`);
    }
  };

  const dispose = async () => {
    const sw = stopwatch();
    try {
      logger.info(`[CpuProfiler] Disabling profiling...`);
      await new Promise<void>((resolve, reject) => {
        try {
          session.post('Profiler.disable', error => {
            if (error && isInspectorNotConnectedError(error)) {
              logger.info(`[CpuProfiler] Profiler already disconnected`);
              resolve();
            } else if (error) {
              logger.error(error, '[CpuProfiler] Error disabling profiling');
              reject(error);
            } else {
              logger.info(`[CpuProfiler] Profiling disabled`);
              resolve();
            }
          });
        } catch (error) {
          if (isInspectorNotConnectedError(error)) {
            logger.info(`[CpuProfiler] Profiler already disconnected`);
            resolve();
          } else {
            reject();
          }
        }
      });
    } finally {
      session.disconnect();
      logger.info(
        `[CpuProfiler] Disable and disconnect profiler took ${sw.getElapsedAndRestart()}ms`
      );
    }
  };

  return { start, stop, dispose, session, sessionType: 'cpu', stopwatch: sessionStopwatch };
}

/**
 * Connects and enables a new `inspector` session, then creates an internal v8 Heap profiler snapshot.
 * @param outputStream - An output stream that heap snapshot chunks are written to.
 * The result stream can be used to create a `.heapsnapshot` file.
 * Use Chrome's 'DevTools for Node' (under chrome://inspect) to visualize the `.heapsnapshot` file.
 */
function initHeapSnapshot(
  outputStream: stream.Writable
): ProfilerInstance<{ totalSnapshotByteSize: number }> {
  const sw = stopwatch();
  const session = new inspector.Session();
  session.connect();
  let totalSnapshotByteSize = 0;
  const start = async () => {
    logger.info(`[HeapProfiler] Enabling profiling...`);
    await new Promise<void>((resolve, reject) => {
      try {
        session.post('HeapProfiler.enable', error => {
          if (error) {
            logger.error(error, '[HeapProfiler] Error enabling profiling');
            reject(error);
          } else {
            sw.restart();
            logger.info(`[HeapProfiler] Profiling enabled`);
            resolve();
          }
        });
      } catch (error) {
        logger.error(error, '[HeapProfiler] Error enabling profiling');
        reject(error);
      }
    });

    session.on('HeapProfiler.addHeapSnapshotChunk', message => {
      // Note: this doesn't handle stream back-pressure, but we don't have control over the
      // `HeapProfiler.addHeapSnapshotChunk` callback in order to use something like piping.
      // So in theory on a slow `outputStream` (usually an http connection response) this can cause OOM.
      logger.info(
        `[HeapProfiler] Writing heap snapshot chunk of size ${message.params.chunk.length}`
      );
      totalSnapshotByteSize += message.params.chunk.length;
      outputStream.write(message.params.chunk, error => {
        if (error) {
          logger.error(
            error,
            `[HeapProfiler] Error writing heap profile chunk to output stream: ${error.message}`
          );
        }
      });
    });
  };

  const stop = async () => {
    logger.info(`[HeapProfiler] Taking snapshot...`);
    await new Promise<void>((resolve, reject) => {
      try {
        session.post('HeapProfiler.takeHeapSnapshot', undefined, (error: Error | null) => {
          if (error) {
            logger.error(error, '[HeapProfiler] Error taking snapshot');
            reject(error);
          } else {
            logger.info(
              `[HeapProfiler] Taking snapshot completed, ${totalSnapshotByteSize} bytes...`
            );
            resolve();
          }
        });
      } catch (error) {
        logger.error(error, '[HeapProfiler] Error taking snapshot');
        reject(error);
      }
    });
    logger.info(`[HeapProfiler] Draining snapshot buffer to stream...`);
    const writeFinishedPromise = new Promise<void>((resolve, reject) => {
      outputStream.on('finish', () => resolve());
      outputStream.on('error', error => reject(error));
    });
    outputStream.end();
    await writeFinishedPromise;
    logger.info(`[HeapProfiler] Finished draining snapshot buffer to stream`);
    return { totalSnapshotByteSize };
  };

  const dispose = async () => {
    try {
      logger.info(`[HeapProfiler] Disabling profiling...`);
      await new Promise<void>((resolve, reject) => {
        try {
          session.post('HeapProfiler.disable', error => {
            if (error && isInspectorNotConnectedError(error)) {
              logger.info(`[HeapProfiler] Profiler already disconnected`);
              resolve();
            } else if (error) {
              logger.error(error, '[HeapProfiler] Error disabling profiling');
              reject(error);
            } else {
              logger.info(`[HeapProfiler] Profiling disabled`);
              resolve();
            }
          });
        } catch (error) {
          if (isInspectorNotConnectedError(error)) {
            logger.info(`[HeapProfiler] Profiler already disconnected`);
            resolve();
          } else {
            reject();
          }
        }
      });
    } finally {
      session.disconnect();
    }
  };

  return { start, stop, dispose, session, sessionType: 'memory', stopwatch: sw };
}

export async function startProfilerServer(httpServerPort?: number | string): Promise<{
  server: Server;
  address: string;
  close: () => Promise<void>;
}> {
  let serverPort: number | undefined = undefined;
  if (httpServerPort !== undefined) {
    serverPort = parsePort(httpServerPort);
  }

  const fastify = Fastify({ logger: logger });

  let existingSession:
    | { instance: ProfilerInstance<unknown>; response: import('http').ServerResponse }
    | undefined;
  let neonProfilerRunning = false;

  fastify.get<{
    Querystring: { duration: string; sampling_interval?: string };
  }>('/profile/cpu', async (req, reply) => {
    if (existingSession) {
      return reply.status(409).send({ error: 'Profile session already in progress' });
    }
    const durationParam = req.query['duration'];
    const seconds = Number.parseFloat(durationParam);
    if (!Number.isFinite(seconds) || seconds < 0) {
      return reply
        .status(400)
        .send({ error: `Invalid 'duration' query parameter "${durationParam}"` });
    }
    const samplingIntervalParam = req.query['sampling_interval'];
    let samplingInterval: number | undefined;
    if (samplingIntervalParam !== undefined) {
      samplingInterval = Number.parseFloat(samplingIntervalParam);
      if (!Number.isInteger(samplingInterval) || samplingInterval < 0) {
        return reply.status(400).send({
          error: `Invalid 'sampling_interval' query parameter "${samplingIntervalParam}"`,
        });
      }
    }
    const cpuProfiler = initCpuProfiling(samplingInterval);
    existingSession = { instance: cpuProfiler, response: reply.raw };
    try {
      const filename = `cpu_${Math.round(Date.now() / 1000)}_${seconds}-seconds.cpuprofile`;
      reply.header('Cache-Control', 'no-store');
      reply.header('Transfer-Encoding', 'chunked');
      reply.header('Content-Disposition', `attachment; filename="${filename}"`);
      reply.header('Content-Type', 'application/json; charset=utf-8');
      reply.raw.flushHeaders();
      await cpuProfiler.start();
      const ac = new AbortController();
      const timeoutPromise = timeout(seconds * 1000, ac);
      await Promise.race([timeoutPromise, once(reply.raw, 'close')]);
      if (reply.raw.writableEnded || reply.raw.destroyed) {
        ac.abort();
        return;
      }
      const result = await cpuProfiler.stop();
      const resultString = JSON.stringify(result);
      logger.info(
        `[CpuProfiler] Completed, total profile report JSON string length: ${resultString.length}`
      );
      reply.raw.end(resultString);
    } finally {
      const session = existingSession;
      existingSession = undefined;
      await session?.instance.dispose().catch();
    }
  });

  fastify.get<{
    Querystring: { sampling_interval?: string };
  }>('/profile/cpu/start', async (req, reply) => {
    if (existingSession) {
      return reply.status(409).send({ error: 'Profile session already in progress' });
    }
    const samplingIntervalParam = req.query['sampling_interval'];
    let samplingInterval: number | undefined;
    if (samplingIntervalParam !== undefined) {
      samplingInterval = Number.parseFloat(samplingIntervalParam);
      if (!Number.isInteger(samplingInterval) || samplingInterval < 0) {
        return reply.status(400).send({
          error: `Invalid 'sampling_interval' query parameter "${samplingIntervalParam}"`,
        });
      }
    }
    const cpuProfiler = initCpuProfiling(samplingInterval);
    existingSession = { instance: cpuProfiler, response: reply.raw };
    await cpuProfiler.start();
    const profilerRunningLogger = setInterval(() => {
      if (existingSession) {
        logger.error(`CPU profiler has been enabled for a long time`);
      } else {
        clearInterval(profilerRunningLogger);
      }
    }, 10_000).unref();
    await reply.send('CPU profiler started');
  });

  fastify.get('/profile/native/cpu/start', async (_req, reply) => {
    if (neonProfilerRunning) {
      return reply.status(500).send('error: profiler already started');
    }
    neonProfilerRunning = true;
    try {
      const startResponse = startProfiler();
      console.log(startResponse);
      await reply.send(startResponse);
    } catch (error) {
      console.error(error);
      return reply.status(500).send(String(error));
    }
  });

  fastify.get('/profile/native/cpu/stop', async (_req, reply) => {
    if (!neonProfilerRunning) {
      return reply.status(500).send('error: no profiler running');
    }
    neonProfilerRunning = false;
    let profilerResults: Buffer;
    try {
      profilerResults = stopProfiler();
    } catch (error: any) {
      console.error(error);
      return reply.status(500).send(error);
    }
    const fileName = `profile-${Date.now()}.svg`;
    reply.header('Cache-Control', 'no-store');
    reply.header('Transfer-Encoding', 'chunked');
    reply.header('Content-Disposition', `attachment; filename="${fileName}"`);
    reply.header('Content-Type', 'image/svg+xml');
    return reply.send(profilerResults);
  });

  fastify.get('/profile/cpu/stop', async (req, reply) => {
    if (!existingSession) {
      return reply.status(409).send({ error: 'No profile session in progress' });
    }
    if (existingSession.instance.sessionType !== 'cpu') {
      return reply.status(409).send({ error: 'No CPU profile session in progress' });
    }
    try {
      const elapsedSeconds = existingSession.instance.stopwatch.getElapsedSeconds();
      const timestampSeconds = Math.round(Date.now() / 1000);
      const filename = `cpu_${timestampSeconds}_${elapsedSeconds}-seconds.cpuprofile`;
      const result = await (
        existingSession.instance as ProfilerInstance<inspector.Profiler.Profile>
      ).stop();
      const resultString = JSON.stringify(result);
      logger.info(
        `[CpuProfiler] Completed, total profile report JSON string length: ${resultString.length}`
      );

      reply.header('Cache-Control', 'no-store');
      reply.header('Transfer-Encoding', 'chunked');
      reply.header('Content-Disposition', `attachment; filename="${filename}"`);
      reply.header('Content-Type', 'application/json; charset=utf-8');
      reply.raw.end(resultString);
    } finally {
      const session = existingSession;
      existingSession = undefined;
      await session?.instance.dispose().catch();
    }
  });

  fastify.get('/profile/heap_snapshot', async (req, reply) => {
    if (existingSession) {
      return reply.status(409).send({ error: 'Profile session already in progress' });
    }
    const filename = `heap_${Math.round(Date.now() / 1000)}.heapsnapshot`;
    const tmpFile = path.join(os.tmpdir(), filename);
    const fileWriteStream = fs.createWriteStream(tmpFile);
    const heapProfiler = initHeapSnapshot(fileWriteStream);
    existingSession = { instance: heapProfiler, response: reply.raw };
    try {
      reply.header('Cache-Control', 'no-store');
      reply.header('Transfer-Encoding', 'chunked');
      reply.header('Content-Disposition', `attachment; filename="${filename}"`);
      reply.header('Content-Type', 'application/json; charset=utf-8');
      reply.raw.flushHeaders();
      await heapProfiler.start();
      const result = await heapProfiler.stop();
      logger.info(
        `[HeapProfiler] Completed, total snapshot byte size: ${result.totalSnapshotByteSize}`
      );
      await pipelineAsync(fs.createReadStream(tmpFile), reply.raw);
    } finally {
      const session = existingSession;
      existingSession = undefined;
      await session?.instance.dispose().catch();
      try {
        fileWriteStream.destroy();
      } catch (_) {}
      try {
        logger.info(`[HeapProfiler] Cleaning up tmp file ${tmpFile}`);
        fs.unlinkSync(tmpFile);
      } catch (_) {}
    }
  });

  fastify.get('/profile/cancel', async (_req, reply) => {
    if (!existingSession) {
      return reply.status(409).send({ error: 'No existing profile session is exists to cancel' });
    }
    const session = existingSession;
    await session.instance.stop().catch();
    await session.instance.dispose().catch();
    session.response.destroy();
    existingSession = undefined;
    await Promise.resolve();
    await reply.send({ ok: 'existing profile session stopped' });
  });

  const server = createServer(fastify.server);

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
