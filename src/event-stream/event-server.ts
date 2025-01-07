import * as net from 'net';
import Fastify, { FastifyRequest, FastifyServerOptions } from 'fastify';
import { ChainID, getIbdBlockHeight } from '../helpers';
import {
  CoreNodeBlockMessage,
  CoreNodeBurnBlockMessage,
  CoreNodeDropMempoolTxMessage,
  CoreNodeAttachmentMessage,
  CoreNodeMicroblockMessage,
} from './core-node-message';
import { PgWriteStore } from '../datastore/pg-write-store';
import { handleBnsImport } from '../import-v1';
import { logger } from '../logger';
import { isProdEnv, PINO_LOGGER_CONFIG } from '@hirosystems/api-toolkit';
import { EventMessageHandler, newEventMessageHandler } from './event-message-handler';

const IBD_PRUNABLE_ROUTES = ['/new_mempool_tx', '/drop_mempool_tx', '/new_microblocks'];

export type EventStreamServer = net.Server & {
  serverAddress: net.AddressInfo;
  closeAsync: () => Promise<void>;
};

export async function startEventServer(opts: {
  datastore: PgWriteStore;
  chainId: ChainID;
  messageHandler?: EventMessageHandler;
  /** If not specified, this is read from the STACKS_CORE_EVENT_HOST env var. */
  serverHost?: string;
  /** If not specified, this is read from the STACKS_CORE_EVENT_PORT env var. */
  serverPort?: number;
}): Promise<EventStreamServer> {
  const db = opts.datastore;
  const messageHandler = opts.messageHandler ?? newEventMessageHandler();

  let eventHost = opts.serverHost ?? process.env['STACKS_CORE_EVENT_HOST'];
  const eventPort = opts.serverPort ?? parseInt(process.env['STACKS_CORE_EVENT_PORT'] ?? '', 10);
  if (!eventHost) {
    throw new Error(
      `STACKS_CORE_EVENT_HOST must be specified, e.g. "STACKS_CORE_EVENT_HOST=127.0.0.1"`
    );
  }
  if (!Number.isInteger(eventPort)) {
    throw new Error(`STACKS_CORE_EVENT_PORT must be specified, e.g. "STACKS_CORE_EVENT_PORT=3700"`);
  }

  if (eventHost.startsWith('http:')) {
    const { hostname } = new URL(eventHost);
    eventHost = hostname;
  }

  const bodyLimit = 1_000_000 * 500; // 500MB body limit

  const reqLogSerializer = (req: FastifyRequest) => ({
    method: req.method,
    url: req.url,
    version: req.headers?.['accept-version'] as string,
    hostname: req.hostname,
    remoteAddress: req.ip,
    remotePort: req.socket?.remotePort,
    bodySize: parseInt(req.headers?.['content-length'] as string) || 'unknown',
  });

  const loggerOpts: FastifyServerOptions['logger'] = {
    ...PINO_LOGGER_CONFIG,
    name: 'stacks-node-event',
    serializers: {
      req: reqLogSerializer,
      res: reply => ({
        statusCode: reply.statusCode,
        method: reply.request?.method,
        url: reply.request?.url,
        requestBodySize: parseInt(reply.request?.headers['content-length'] as string) || 'unknown',
        responseBodySize: parseInt(reply.getHeader?.('content-length') as string) || 'unknown',
      }),
    },
  };

  const app = Fastify({
    bodyLimit,
    trustProxy: true,
    logger: loggerOpts,
    ignoreTrailingSlash: true,
  });

  app.addHook('onRequest', (req, reply, done) => {
    req.raw.on('close', () => {
      if (req.raw.aborted) {
        req.log.warn(
          reqLogSerializer(req),
          `Request was aborted by the client: ${req.method} ${req.url}`
        );
      }
    });
    done();
  });

  const handleRawEventRequest = async (req: FastifyRequest) => {
    await messageHandler.handleRawEventRequest(req.url, req.body, db);

    if (logger.level === 'debug') {
      let payload = JSON.stringify(req.body);
      // Skip logging massive event payloads, this _should_ only exclude the genesis block payload which is ~80 MB.
      if (payload.length > 10_000_000) {
        payload = 'payload body too large for logging';
      }
      logger.debug(`${req.url} ${payload}`, { component: 'stacks-node-event' });
    }
  };

  const ibdHeight = getIbdBlockHeight();
  if (ibdHeight) {
    app.addHook('preHandler', async (req, res) => {
      if (IBD_PRUNABLE_ROUTES.includes(req.url)) {
        try {
          const chainTip = await db.getChainTip(db.sql);
          if (chainTip.block_height <= ibdHeight) {
            await handleRawEventRequest(req);
            await res.status(200).send(`IBD`);
          }
        } catch (error) {
          await res
            .status(500)
            .send({ message: 'A middleware error occurred processing the request in IBD mode.' });
        }
      }
    });
  }

  app.get('/', async (_req, res) => {
    await res
      .status(200)
      .send({ status: 'ready', msg: 'API event server listening for core-node POST messages' });
  });

  app.post('/new_block', async (req, res) => {
    try {
      const blockMessage = req.body as CoreNodeBlockMessage;
      await messageHandler.handleBlockMessage(opts.chainId, blockMessage, db);
      if (blockMessage.block_height === 1) {
        await handleBnsImport(db);
      }
      await handleRawEventRequest(req);
      await res.status(200).send({ result: 'ok' });
    } catch (error) {
      logger.error(error, 'error processing core-node /new_block');
      await res.status(500).send({ error: error });
    }
  });

  app.post('/new_burn_block', async (req, res) => {
    try {
      const msg = req.body as CoreNodeBurnBlockMessage;
      await messageHandler.handleBurnBlock(msg, db);
      await handleRawEventRequest(req);
      await res.status(200).send({ result: 'ok' });
    } catch (error) {
      logger.error(error, 'error processing core-node /new_burn_block');
      await res.status(500).send({ error: error });
    }
  });

  app.post('/new_mempool_tx', async (req, res) => {
    try {
      const rawTxs = req.body as string[];
      await messageHandler.handleMempoolTxs(rawTxs, db);
      await handleRawEventRequest(req);
      await res.status(200).send({ result: 'ok' });
    } catch (error) {
      logger.error(error, 'error processing core-node /new_mempool_tx');
      await res.status(500).send({ error: error });
    }
  });

  app.post('/drop_mempool_tx', async (req, res) => {
    try {
      const msg = req.body as CoreNodeDropMempoolTxMessage;
      await messageHandler.handleDroppedMempoolTxs(msg, db);
      await handleRawEventRequest(req);
      await res.status(200).send({ result: 'ok' });
    } catch (error) {
      logger.error(error, 'error processing core-node /drop_mempool_tx');
      await res.status(500).send({ error: error });
    }
  });

  app.post('/attachments/new', async (req, res) => {
    try {
      const msg = req.body as CoreNodeAttachmentMessage[];
      await messageHandler.handleNewAttachment(msg, db);
      await handleRawEventRequest(req);
      await res.status(200).send({ result: 'ok' });
    } catch (error) {
      logger.error(error, 'error processing core-node /attachments/new');
      await res.status(500).send({ error: error });
    }
  });

  app.post('/new_microblocks', async (req, res) => {
    try {
      const msg = req.body as CoreNodeMicroblockMessage;
      await messageHandler.handleMicroblockMessage(opts.chainId, msg, db);
      await handleRawEventRequest(req);
      await res.status(200).send({ result: 'ok' });
    } catch (error) {
      logger.error(error, 'error processing core-node /new_microblocks');
      await res.status(500).send({ error: error });
    }
  });

  app.post('/stackerdb_chunks', async (req, res) => {
    try {
      await handleRawEventRequest(req);
      if (isProdEnv) {
        logger.warn(
          'Received stackerdb_chunks message -- event not required for API operations and can cause db bloat and performance degradation in production'
        );
      }
      await res.status(200).send({ result: 'ok' });
    } catch (error) {
      logger.error(error, 'error processing core-node /stackerdb_chunks');
      await res.status(500).send({ error: error });
    }
  });

  app.post('/proposal_response', async (req, res) => {
    try {
      await handleRawEventRequest(req);
      if (isProdEnv) {
        logger.warn(
          'Received proposal_response message -- event not required for API operations and can cause db bloat and performance degradation in production'
        );
      }
      await res.status(200).send({ result: 'ok' });
    } catch (error) {
      logger.error(error, 'error processing core-node /proposal_response');
      await res.status(500).send({ error: error });
    }
  });

  app.post('*', async (req, res) => {
    await res.status(404).send({ error: `no route handler for ${req.url}` });
    logger.error(`Unexpected event on path ${req.url}`);
  });

  const addr = await app.listen({ port: eventPort, host: eventHost });
  logger.info(`Event observer listening at: ${addr}`);

  const closeFn = async () => {
    logger.info('Closing event observer server...');
    await app.close();
  };
  const eventStreamServer: EventStreamServer = Object.assign(app.server, {
    serverAddress: app.addresses()[0],
    closeAsync: closeFn,
  });
  return eventStreamServer;
}
