#!/usr/bin/env ts-node
'use strict';

import { promises as fs } from 'fs';
import * as glob from 'glob';
import { compile } from 'json-schema-to-typescript';

const dataEncoding = 'utf8';
const shouldGenerateTypeFor = (schema: { title?: string }) => !!schema.title;
const typeFileName = '.tmp/index.ts';

const clearFile = async () => await fs.writeFile(typeFileName, '');

glob('.tmp/**/*.schema.json', (_err, files) => {
  if (files.length === 0) {
    console.log('No schemas. Have you ran `yarn deref-schemas`?');
  }

  (async function () {
    await clearFile();

    for await (const file of files) {
      const schema = JSON.parse(await fs.readFile(file, dataEncoding));

      if (!shouldGenerateTypeFor(schema)) continue;

      const result = await compile(schema, schema.title, {
        bannerComment: '',
      });

      await fs.appendFile(typeFileName, result);
    }
    process.exit(0);
  })();
});
