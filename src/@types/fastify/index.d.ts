import fastify from 'fastify';
import { PgStore } from '../../datastore/pg-store';
import { PgWriteStore } from '../../datastore/pg-write-store';

declare module 'fastify' {
  interface FastifyInstance {
    db: PgStore;
    writeDb?: PgWriteStore;
    chainId: ChainID;
  }
}
