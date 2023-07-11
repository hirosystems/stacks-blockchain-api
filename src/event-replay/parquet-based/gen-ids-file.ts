import * as fs from 'fs';

import { logger } from '../../logger';
import { DatasetStore } from './dataset/store';
import { splitIntoChunks } from './helpers';

(async () => {
  const args = process.argv.slice(2);
  const workers: number = Number(args[0].split('=')[1]);

  logger.info({ component: 'event-replay' }, `Generating ID files for ${workers} parallel workers`);

  const dir = './events/new_block';

  const dataset = DatasetStore.connect();

  const ids: number[] = await dataset.newBlockEventsIds();
  const batchSize = Math.ceil(ids.length / workers);
  const chunks = splitIntoChunks(ids, batchSize);

  const files = fs.readdirSync(dir).filter(f => f.endsWith('txt'));

  // delete previous files
  files.map(
    file =>
      new Promise((resolve, reject) => {
        try {
          fs.unlinkSync(`${dir}/${file}`);
        } catch (err) {
          throw err;
        }
      })
  );

  // create id files
  chunks.forEach((chunk, idx) => {
    const filename = `./events/new_block/ids_${idx + 1}.txt`;
    chunk.forEach(id => {
      fs.writeFileSync(filename, id.toString() + '\n', { flag: 'a' });
    });
  });
})().catch(err => {
  throw new err();
});
