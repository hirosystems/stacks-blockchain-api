import fastify from 'fastify';
import { PgStore } from '../../datastore/pg-store.js';
import { PgWriteStore } from '../../datastore/pg-write-store.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: PgStore;
    writeDb?: PgWriteStore;
    chainId: ChainID;
  }
}
