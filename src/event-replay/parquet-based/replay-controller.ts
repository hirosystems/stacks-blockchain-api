import * as tty from 'tty';
import * as fs from 'fs';

import { PgWriteStore } from '../../datastore/pg-write-store';
import { logger } from '../../logger';
import { createTimeTracker, genIdsFiles } from './helpers';
import { processNewBurnBlockEvents } from './importers/new-burn-block-importer';
import { processAttachmentNewEvents } from './importers/attachment-new-importer';
import { processRawEvents } from './importers/raw-importer';
import { processRemainderEvents } from './importers/remainder-importer';
import { DatasetStore } from './dataset/store';
import { IndexesState } from '../../datastore/common';
import { importV1TokenOfferingData } from '../../import-v1';

import * as _cluster from 'cluster';
const cluster = _cluster as unknown as _cluster.Cluster; // typings fix

import { FILE_PATH as raw_worker_path } from './workers/raw-worker';
import { FILE_PATH as new_block_worker_path } from './workers/new-block-worker';
import { cycleMigrations, dangerousDropAllTables } from '@hirosystems/api-toolkit';
import { PgServer, getConnectionArgs } from '../../datastore/connection';
import { MIGRATIONS_DIR } from '../../datastore/pg-store';

const EVENTS_DIR = process.env.STACKS_EVENTS_DIR;

/**
 * This class is an entry point for the event-replay based on parquet files,
 * being responsible to start the replay process (check "do" method).
 *
 * It also has functions to prepare and finalize the database for an event-replay.
 */
// ts-unused-exports:disable-next-line
export class ReplayController {
  private readonly db;
  private readonly dataset;

  /**
   *
   */
  private constructor(db: PgWriteStore, dataset: DatasetStore) {
    this.db = db;
    this.dataset = dataset;
  }

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
    try {
      if (fs.existsSync(`${EVENTS_DIR}/attachments_new`)) {
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
      }
    } catch (err) {
      throw err;
    }
  };

  /**
   *
   */
  ingestRawEvents = async () => {
    const timeTracker = createTimeTracker();

    try {
      await timeTracker.track('RAW_EVENTS', async () => {
        await processRawEvents(this.db, this.dataset);
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

  ingestRawNewBlockEvents = async () => {
    return new Promise(async resolve => {
      cluster.setupPrimary({
        exec: raw_worker_path,
      });

      let workersReady = 0;
      const idFiles = await genIdsFiles(this.dataset);
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
  ingestNewBlockEvents = (): Promise<boolean> => {
    return new Promise(async resolve => {
      cluster.setupPrimary({
        exec: new_block_worker_path,
      });

      let workersReady = 0;
      const idFiles = await genIdsFiles(this.dataset);
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
  private ingestRemainderEvents = async () => {
    const timeTracker = createTimeTracker();

    try {
      await timeTracker.track('REMAINDER_EVENTS', async () => {
        await processRemainderEvents(this.db, this.dataset);
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
  prepare = async () => {
    const args = getConnectionArgs(PgServer.primary);
    logger.info({ component: 'event-replay' }, 'Cleaning up the Database');
    await dangerousDropAllTables(args, { acknowledgePotentialCatastrophicConsequences: 'yes' });

    logger.info({ component: 'event-replay' }, 'Migrating tables');
    try {
      await cycleMigrations(MIGRATIONS_DIR, args, {
        dangerousAllowDataLoss: true,
        checkForEmptyData: true,
      });
    } catch (error) {
      logger.error(error);
      throw new Error('DB migration cycle failed');
    }

    // Disabling indexes
    logger.info(
      { component: 'event-replay' },
      'Disabling indexes and constraints to speed up insertion'
    );
    await this.db.toggleAllTableIndexes(this.db.sql, IndexesState.Off);
  };

  /**
   *
   */
  finalize = async () => {
    logger.info({ component: 'event-replay' }, 'Importing Token Offering Data');
    await importV1TokenOfferingData(this.db);

    // Re-enabling indexes
    logger.info({ component: 'event-replay' }, 'Re-enabling indexes and constraints on tables');
    await this.db.toggleAllTableIndexes(this.db.sql, IndexesState.On);

    // Re-indexing tables
    logger.info({ component: 'event-replay' }, 'Re-indexing tables');
    await this.db.reindexAllTables(this.db.sql);

    // Remainder events to be replayed with regular HTTP POSTs
    await this.ingestRemainderEvents();

    // Close DB
    logger.info({ component: 'event-replay' }, 'Closing DB connection');
    await this.db.close();

    // Exit with success
    logger.info({ component: 'event-replay' }, 'Finishing event-replay with success');
    process.exit(0);
  };

  /**
   * This funtion is responsible to initialize the event-replay process.
   */
  do = async () => {
    // NEW_BLOCK events
    await this.ingestNewBlockEvents();

    // RAW events to event_observer_requests table
    await this.ingestRawEvents();
    await this.ingestRawNewBlockEvents();

    // NEW_BURN_BLOCK and ATTACHMENTS/NEW events
    await Promise.all([this.ingestNewBurnBlockEvents(), this.ingestAttachmentNewEvents()]);
  };
}
