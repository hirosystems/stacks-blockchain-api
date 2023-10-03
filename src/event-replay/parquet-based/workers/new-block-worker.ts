import * as fs from 'fs';
import * as tty from 'tty';

import { processNewBlockEvents } from '../importers/new-block-importer';
import { PgWriteStore } from '../../../datastore/pg-write-store';
import { DatasetStore } from '../dataset/store';
import { logger } from '../../../logger';
import { createTimeTracker } from '../helpers';

export const FILE_PATH = __filename;

const ingestNewBlock = async (idFile?: string) => {
  const db = await PgWriteStore.connect({
    usageName: `${idFile}`,
    skipMigrations: true,
    withNotifier: false,
    isEventReplay: true,
  });
  const dataset = DatasetStore.connect();

  const timeTracker = createTimeTracker();

  const dir = `${process.env.STACKS_EVENTS_DIR}/new_block`;

  try {
    const idsFileContent = fs.readFileSync(`${dir}/${idFile}`, 'utf-8');
    const ids = idsFileContent.split(/\r?\n/);

    await timeTracker.track('NEW_BLOCK_EVENTS', async () => {
      await processNewBlockEvents(db, dataset, ids);
    });

    // notify parent
    process.send?.({
      msgType: 'FINISH',
      msg: 'Worker has finished',
    });
  } catch (err) {
    throw err;
  } finally {
    if (true || tty.isatty(1)) {
      console.table(timeTracker.getDurations(3));
    } else {
      logger.info(`Tracked function times`, timeTracker.getDurations(3));
    }
  }
};

process.on('message', async (msg: string) => {
  await ingestNewBlock(msg);
});
