import { promises as fs } from 'fs';
import * as path from 'path';

import * as glob from 'glob';
import { JSONSchema4 } from 'json-schema';
import * as mergeSchemas from 'json-schema-merge-allof';
import * as deref from '@apidevtools/json-schema-ref-parser';
import { compile } from 'json-schema-to-typescript';

const root = path.join(__dirname, '..');
const docsPath = path.join(root, 'docs');
const tmpPath = path.join(root, '.tmp');
const typeFilePath = path.join(tmpPath, 'index.d.ts');

const clearFile = async () => {
  try {
    await fs.access(tmpPath);
  } catch (e) {
    await fs.mkdir(tmpPath);
  }
  await fs.writeFile(typeFilePath, '', 'utf8');
};

glob(path.join(docsPath, '**/*.schema.json'), async (err, files) => {
  if (err) throw err;

  await clearFile();

  for await (const file of files) {
    const derefedSchema = await deref.dereference(file);
    const schema = mergeSchemas(derefedSchema, {
      ignoreAdditionalProperties: true,
    });
    if (!schema.title) continue;
    if (schema.type === 'object') {
      schema.additionalProperties = false;
    }
    const outputType = await compile(schema as JSONSchema4, schema.title, {
      bannerComment: '',
      strictIndexSignatures: true,
      declareExternallyReferenced: false,
    });
    await fs.appendFile(typeFilePath, outputType);
  }

  process.exit(0);
});
