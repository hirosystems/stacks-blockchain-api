import * as tty from 'tty';
import * as fs from 'fs';

import { PgWriteStore } from '../../datastore/pg-write-store';
import { logger } from '../../logger';
import { createTimeTracker } from './helpers';
import { processNewBurnBlockEvents } from './importers/new-burn-block-importer';
import { processAttachmentNewEvents } from './importers/attachment-new-importer';
import { DatasetStore } from './dataset/store';
import { cycleMigrations, dangerousDropAllTables } from '../../datastore/migrations';
import { splitIntoChunks } from './helpers';

import * as _cluster from 'cluster';
const cluster = (_cluster as unknown) as _cluster.Cluster; // typings fix

const MIGRATIONS_TABLE = 'pgmigrations';

enum IndexesState {
  On,
  Off,
}

export class ReplayController {
  private readonly db;
  private readonly dataset;

  private constructor(db: PgWriteStore, dataset: DatasetStore) {
    this.db = db;
    this.dataset = dataset;
  }

  /**
   *
   */
  private ingestNewBurnBlockEvents = async () => {
    const timeTracker = createTimeTracker();

    try {
      await timeTracker.track('NEW_BURN_BLOCK_EVENTS', async () => {
        await processNewBurnBlockEvents(this.db, this.dataset);
      });
    } catch (err) {
      throw err;
    } finally {
      if (true || tty.isatty(1)) {
        console.log('Tracked function times:');
        console.table(timeTracker.getDurations(3));
      } else {
        logger.info(`Tracked function times`, timeTracker.getDurations(3));
      }
    }
  };

  /**
   *
   */
  private ingestAttachmentNewEvents = async () => {
    const timeTracker = createTimeTracker();

    try {
      await timeTracker.track('ATTACHMENTS_NEW_EVENTS', async () => {
        await processAttachmentNewEvents(this.db, this.dataset);
      });
    } catch (err) {
      throw err;
    } finally {
      if (true || tty.isatty(1)) {
        console.log('Tracked function times:');
        console.table(timeTracker.getDurations(3));
      } else {
        logger.info(`Tracked function times`, timeTracker.getDurations(3));
      }
    }
  };

  /**
   *
   */
  private toggleIndexes = async (state: IndexesState) => {
    const db = this.db;
    const dbName = db.sql.options.database;
    const tableSchema = db.sql.options.connection.search_path ?? 'public';
    const tablesQuery = await db.sql<{ tablename: string }[]>`
      SELECT tablename FROM pg_catalog.pg_tables
      WHERE tablename != ${MIGRATIONS_TABLE}
      AND schemaname = ${tableSchema}`;
    if (tablesQuery.length === 0) {
      const errorMsg = `No tables found in database '${dbName}', schema '${tableSchema}'`;
      console.error(errorMsg);
      throw new Error(errorMsg);
    }
    const tables: string[] = tablesQuery.map((r: { tablename: string }) => r.tablename);

    if (state === IndexesState.Off) {
      await db.toggleTableIndexes(db.sql, tables, false);
    } else if (state == IndexesState.On) {
      await db.toggleTableIndexes(db.sql, tables, true);
    }
  };

  /**
   *
   */
  prepare = async () => {
    logger.info({ component: 'event-replay' }, 'Cleaning up the Database');
    await dangerousDropAllTables({ acknowledgePotentialCatastrophicConsequences: 'yes' });

    logger.info({ component: 'event-replay' }, 'Migrating tables');
    try {
      await cycleMigrations({ dangerousAllowDataLoss: true, checkForEmptyData: true });
    } catch (error) {
      logger.error(error);
      throw new Error('DB migration cycle failed');
    }

    // Disabling indexes
    logger.info(
      { component: 'event-replay' },
      'Disabling indexes and constraints to speed up insertion'
    );
    await this.toggleIndexes(IndexesState.Off);
  };

  /**
   *
   */
  private genIdsFiles = async () => {
    const args = process.argv.slice(2);
    const workers: number = Number(args[1].split('=')[1]);

    logger.info(
      { component: 'event-replay' },
      `Generating ID files for ${workers} parallel workers`
    );

    const dir = './events/new_block';

    const ids: number[] = await this.dataset.newBlockEventsIds();
    const batchSize = Math.ceil(ids.length / workers);
    const chunks = splitIntoChunks(ids, batchSize);

    const files = fs.readdirSync(dir).filter(f => f.endsWith('txt'));

    // delete previous files
    files.map(file => {
      try {
        fs.unlinkSync(`${dir}/${file}`);
      } catch (err) {
        throw err;
      }
    });

    // create id files
    chunks.forEach((chunk, idx) => {
      const filename = `./events/new_block/ids_${idx + 1}.txt`;
      chunk.forEach(id => {
        fs.writeFileSync(filename, id.toString() + '\n', { flag: 'a' });
      });
    });

    return fs.readdirSync(dir).filter(f => f.endsWith('txt'));
  };

  /**
   *
   */
  static async init() {
    const db = await PgWriteStore.connect({
      usageName: 'event-replay',
      skipMigrations: true,
      withNotifier: false,
      isEventReplay: true,
    });
    const dataset = DatasetStore.connect();

    return new ReplayController(db, dataset);
  }

  /**
   *
   */
  teardown = async () => {
    const db = this.db;

    // Re-enabling indexes
    logger.info({ component: 'event-replay' }, 'Re-enabling indexes and constraints on tables');
    await this.toggleIndexes(IndexesState.On);

    // Refreshing materialized views
    logger.info({ component: 'event-replay' }, `Refreshing materialized views`);
    await db.finishEventReplay();

    await this.db.close();
  };

  ingestNewBlockEvents = (): Promise<boolean> => {
    return new Promise(async resolve => {
      cluster.setupPrimary({
        exec: __dirname + '/new-block-worker',
      });

      let workersReady = 0;
      const idFiles = await this.genIdsFiles();
      for (const idFile of idFiles) {
        cluster.fork().send(idFile);
        workersReady++;
      }

      for (const id in cluster.workers) {
        const worker: _cluster.Worker | undefined = cluster.workers[id];
        worker?.on('message', (msg, _handle) => {
          switch (msg.msgType) {
            case 'FINISH':
              logger.info({ component: 'event-replay' }, `${msg.msg}`);
              workersReady--;
              worker.disconnect();
              break;
            default:
              // default action
              break;
          }
        });

        worker?.on('disconnect', () => {
          if (workersReady === 0) {
            resolve(true);
          }
        });
      }
    });
  };

  /**
   *
   */
  do = async () => {
    await Promise.all([this.ingestNewBurnBlockEvents(), this.ingestAttachmentNewEvents()]);
    await this.ingestNewBlockEvents();
  };
}
