import * as fs from 'fs';

import * as chalk from 'chalk';
import * as glob from 'glob';
import * as Ajv from 'ajv';

const dataEncoding = 'utf8';

const ajv = new Ajv();

glob('.tmp/**/*.example.json', (err, files) => {
  if (err) throw err;
  let exitCode = 0;

  files.forEach(file => {
    let schema;
    let exampleJson;

    //
    // Schemas are precompiled to avoid inconsistent schema fragment resolution
    const schemaFileName = file.replace('example', 'schema').replace('docs', 'dist');

    //
    // JSON likely invalid if error
    try {
      schema = JSON.parse(fs.readFileSync(schemaFileName, dataEncoding));
      exampleJson = JSON.parse(fs.readFileSync(file, dataEncoding));
    } catch (err) {
      throw new Error(`${chalk.red(file)} ${err}`);
    }

    const valid = ajv.validate(schema, exampleJson);

    if (!valid) {
      exitCode = 1;
      console.warn(`[${file}] ${chalk.red('INVALID')}\n`);
      console.warn('Error at', chalk.yellow(file));
      console.warn(ajv.errorsText());
      console.warn('\n');
      return;
    }

    console.log(`[${file}] ${chalk.green('VALID')}`);
  });

  process.exit(exitCode);
});
