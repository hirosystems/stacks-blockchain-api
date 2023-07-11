import { logger } from '../../logger';
import { PgWriteStore } from '../../datastore/pg-write-store';

(async () => {
  const db = await PgWriteStore.connect({
    usageName: 'post-event-replay',
    skipMigrations: true,
    withNotifier: false,
    isEventReplay: true,
  });

  // Refreshing materialized views
  logger.info({ component: 'event-replay' }, `Refreshing materialized views`);
  await db.finishEventReplay();
})().catch(err => {
  throw err;
});
