import * as fs from 'fs';
import { findTsvBlockHeight } from '../event-replay/helpers';
import { ReverseFileStream } from '../event-replay/reverse-file-stream';

describe('event replay tests', () => {
  function writeTmpFile(fileName: string, contents: string): string {
    try {
      fs.mkdirSync('./.tmp');
    } catch (error: any) {
      if (error.code != 'EEXIST') throw error;
    }
    const path = `./.tmp/${fileName}`;
    fs.writeFileSync(path, contents, { encoding: 'utf-8' });
    return path;
  }

  test('ReverseFileStream streams file in reverse', async () => {
    const contents = `line1
line2
line3
line4`;
    const testFilePath = writeTmpFile('test1.txt', contents);
    try {
      const reverseStream = new ReverseFileStream(testFilePath);
      let output = '';
      let linesStreamed = 0;
      for await (const data of reverseStream) {
        linesStreamed++;
        output += data.toString();
      }
      expect(linesStreamed).toEqual(4);
      expect(output).toEqual(`line4
line3
line2
line1`);
    } finally {
      fs.unlinkSync(testFilePath);
    }
  });

  test('TSV block height is found', async () => {
    const contents = `744275\t2022-02-21 16:07:01.123587+00\t/new_mempool_tx\t[]
744275\t2022-02-21 16:07:01.123587+00\t/new_block\t{"block_height": 1200}
744275\t2022-02-21 16:07:01.123587+00\t/new_block\t{"block_height": 1201}
744275\t2022-02-21 16:07:01.123587+00\t/new_mempool_tx\t[]`;
    const testFilePath = writeTmpFile('test1.tsv', contents);
    try {
      const blockHeight = await findTsvBlockHeight(testFilePath);
      expect(blockHeight).toEqual(1201);
    } finally {
      fs.unlinkSync(testFilePath);
    }
  });

  test('TSV block height is 0 if not found', async () => {
    const contents = `744275\t2022-02-21 16:07:01.123587+00\t/new_mempool_tx\t[]
744275\t2022-02-21 16:07:01.123587+00\t/new_mempool_tx\t[]
744275\t2022-02-21 16:07:01.123587+00\t/new_mempool_tx\t[]
744275\t2022-02-21 16:07:01.123587+00\t/new_mempool_tx\t[]`;
    const testFilePath = writeTmpFile('test1.tsv', contents);
    try {
      const blockHeight = await findTsvBlockHeight(testFilePath);
      expect(blockHeight).toEqual(0);
    } finally {
      fs.unlinkSync(testFilePath);
    }
  });
});
