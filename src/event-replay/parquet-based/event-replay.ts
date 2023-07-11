import * as tty from 'tty';
import * as fs from 'fs';

import { PgWriteStore } from '../../datastore/pg-write-store';
import { logger } from '../../logger';
import { createTimeTracker } from './helpers';
import { processNewBurnBlockEvents } from './importers/new-burn-block-importer';
import { processNewBlockEvents } from './importers/new-block-importer';
import { processAttachmentNewEvents } from './importers/attachment-new-importer';
import { DatasetStore } from './dataset/store';

/**
 *
 */
const ingestNewBurnBlock = async () => {
  const timeTracker = createTimeTracker();

  const db = await PgWriteStore.connect({
    usageName: 'event-replay',
    skipMigrations: true,
    withNotifier: false,
    isEventReplay: true,
  });

  const dataset = DatasetStore.connect();

  try {
    await timeTracker.track('NEW_BURN_BLOCK_EVENTS', async () => {
      await processNewBurnBlockEvents(db, dataset);
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

    await db.close();
  }
};

/**
 *
 */
const ingestAttachmentNew = async () => {
  const timeTracker = createTimeTracker();

  const db = await PgWriteStore.connect({
    usageName: 'event-replay',
    skipMigrations: true,
    withNotifier: false,
    isEventReplay: true,
  });

  const dataset = DatasetStore.connect();

  try {
    await timeTracker.track('ATTACHMENTS_NEW_EVENTS', async () => {
      await processAttachmentNewEvents(db, dataset);
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

    await db.close();
  }
};

const ingestNewBlock = async (idsPath?: string) => {
  const timeTracker = createTimeTracker();

  const db = await PgWriteStore.connect({
    usageName: 'event-replay',
    skipMigrations: true,
    withNotifier: false,
    isEventReplay: true,
  });

  const dataset = DatasetStore.connect();

  try {
    const idsFileContent = fs.readFileSync(`${idsPath}`, 'utf-8');
    const ids = idsFileContent.split(/\r?\n/);

    await timeTracker.track('NEW_BLOCK_EVENTS', async () => {
      await processNewBlockEvents(db, dataset, ids);
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

export { ingestNewBlock, ingestAttachmentNew, ingestNewBurnBlock };
