import { loadDotEnv } from '../../../helpers';
import { Database, QueryResult, TableData } from 'duckdb';

loadDotEnv();

const EVENTS_DIR = process.env.STACKS_EVENTS_DIR;

export class DatasetStore {
  private readonly db;

  constructor() {
    this.db = new Database(':memory:');
  }

  static connect(): DatasetStore {
    return new DatasetStore();
  }

  //
  // NEW_BLOCK EVENTS
  //

  newBlockEventsIds = (): Promise<number[]> => {
    const con = this.db.connect();
    return new Promise(resolve => {
      con.all(
        `SELECT id FROM READ_PARQUET('${EVENTS_DIR}/new_block/canonical/*.parquet')`,
        (err: any, result: any) => {
          if (err) {
            throw err;
          }

          const res: number[] = result.map((a: { id: number }) => a.id); // extract IDs as an Array
          resolve(res);
        }
      );
    });
  };

  newBlockEventsPayloadStream = (ids: number[]): Promise<QueryResult> => {
    return new Promise(resolve => {
      const con = this.db.connect();
      const res = con.stream(
        `SELECT payload FROM READ_PARQUET('${EVENTS_DIR}/new_block/canonical/*.parquet') WHERE id IN (${ids}) ORDER BY id`
      );

      resolve(res);
    });
  };

  //
  // NEW_BURN_BLOCK EVENTS
  //

  newBurnBlockEventsOrdered = () => {
    return new Promise(resolve => {
      const con = this.db.connect();
      con.all(
        `SELECT * FROM READ_PARQUET('${EVENTS_DIR}/new_burn_block/canonical/*.parquet') ORDER BY id`,
        (err: any, result: any) => {
          if (err) {
            throw err;
          }

          resolve(result);
        }
      );
    });
  };

  //
  // ATTACHMENTS_NEW EVENTS
  //

  attachmentsCanonicalEvents = (): Promise<QueryResult> => {
    const con = this.db.connect();
    return new Promise(resolve => {
      const res = con.stream(
        `SELECT payload FROM READ_PARQUET('${EVENTS_DIR}/attachments_new/canonical/*.parquet') ORDER BY id`
      );

      resolve(res);
    });
  };

  //
  // RAW EVENTS
  //

  rawEvents = (): Promise<QueryResult> => {
    return new Promise(resolve => {
      const con = this.db.connect();
      con.all(
        `SELECT method, payload FROM READ_PARQUET([
          '${EVENTS_DIR}/new_burn_block/canonical/*.parquet',
          '${EVENTS_DIR}/attachments_new/canonical/*.parquet',
          '${EVENTS_DIR}/new_microblocks/*.parquet',
          '${EVENTS_DIR}/drop_mempool_tx/*.parquet',
          '${EVENTS_DIR}/new_mempool_tx/*.parquet',
        ]) ORDER BY id`,
        (err: any, result: any) => {
          if (err) {
            throw err;
          }

          resolve(result);
        }
      );
    });
  };

  rawEventsByIds = (ids: number[]): Promise<QueryResult> => {
    return new Promise(resolve => {
      const con = this.db.connect();
      const res = con.stream(
        `SELECT method, payload FROM READ_PARQUET('${EVENTS_DIR}/new_block/canonical/*.parquet') WHERE id IN (${ids}) ORDER BY id`
      );

      resolve(res);
    });
  };

  //
  // REMAINDER EVENTS
  //

  remainderEvents = (): Promise<QueryResult> => {
    return new Promise(resolve => {
      const con = this.db.connect();
      con.all(
        `SELECT method, payload FROM READ_PARQUET('${EVENTS_DIR}/remainder/*.parquet') ORDER BY id`,
        (err: any, res: any) => {
          if (err) {
            throw err;
          }

          resolve(res);
        }
      );
    });
  };

  //
  // CANONICAL BLOCK_HASHES
  //

  canonicalBlockHashes = (): Promise<QueryResult> => {
    return new Promise(resolve => {
      const con = this.db.connect();
      con.all(
        `SELECT * FROM READ_PARQUET('${EVENTS_DIR}/canonical/block_hashes/*.parquet')`,
        (err: any, res: any) => {
          if (err) {
            throw err;
          }

          resolve(res);
        }
      );
    });
  };
}
