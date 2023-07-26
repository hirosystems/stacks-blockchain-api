import * as tty from 'tty';

import { PgWriteStore } from '../../datastore/pg-write-store';
import { logger } from '../../logger';
import { createTimeTracker, genIdsFiles } from './helpers';
import { processNewBurnBlockEvents } from './importers/new-burn-block-importer';
import { processAttachmentNewEvents } from './importers/attachment-new-importer';
import { processRawEvents } from './importers/raw-importer';
import { DatasetStore } from './dataset/store';
import { cycleMigrations, dangerousDropAllTables } from '../../datastore/migrations';
import { IndexesState } from '../../datastore/common';

import * as _cluster from 'cluster';
const cluster = (_cluster as unknown) as _cluster.Cluster; // typings fix

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
        exec: __dirname + '/workers/raw-worker',
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
        exec: __dirname + '/workers/new-block-worker',
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
    await this.db.toggleAllTableIndexes(this.db.sql, IndexesState.Off);
  };

  /**
   *
   */
  teardown = async () => {
    // Re-enabling indexes
    logger.info({ component: 'event-replay' }, 'Re-enabling indexes and constraints on tables');
    await this.db.toggleAllTableIndexes(this.db.sql, IndexesState.On);

    // Refreshing materialized views
    logger.info({ component: 'event-replay' }, `Refreshing materialized views`);
    await this.db.finishEventReplay();

    await this.db.close();
  };

  /**
   *
   */
  do = async () => {
    await Promise.all([this.ingestNewBurnBlockEvents(), this.ingestAttachmentNewEvents()]);
    await Promise.all([this.ingestRawEvents(), this.ingestRawNewBlockEvents()]);
    await this.ingestNewBlockEvents();
  };
}
