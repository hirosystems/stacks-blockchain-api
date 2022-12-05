import * as path from 'path';
import Ajv, { ValidateFunction } from 'ajv';
import * as RefParser from '@apidevtools/json-schema-ref-parser';
import { logger, getOrAddAsync, REPO_DIR, getOrAdd } from '../helpers';

// Ajv recommends using a single Ajv instance. This could also be `export`ed
// allowing other code paths to re-use the instance
const ajv = new Ajv();

const derefSchemaCache: Map<string, RefParser.JSONSchema> = new Map();
export async function dereferenceSchema(schemaFilePath: string): Promise<RefParser.JSONSchema> {
  return getOrAddAsync(derefSchemaCache, schemaFilePath, () =>
    RefParser.dereference(schemaFilePath)
  );
}

const validateCache: Map<string, ValidateFunction> = new Map();
export function compileSchema(
  schemaFilePath: string,
  schemaDef: RefParser.JSONSchema
): ValidateFunction {
  return getOrAdd(validateCache, schemaFilePath, () => {
    return ajv.compile(schemaDef);
  });
}

export async function validate(schemaFilePath: string, data: any) {
  if (process.env.NODE_ENV !== 'development') return;
  const resolvedFilePath = getDocSchemaFile(schemaFilePath);
  const schemaDef = await dereferenceSchema(resolvedFilePath);

  const validate = compileSchema(schemaFilePath, schemaDef);
  const valid = validate(data);

  if (!valid) {
    logger.warn(`Schema validation:\n\n ${JSON.stringify(validate.errors, null, 2)}`);
  }
}

export function getDocSchemaFile(packageFile: string) {
  const docsPackageName = '@stacks/stacks-blockchain-api-types';
  if (!packageFile.startsWith(docsPackageName)) {
    throw new Error(
      `Doc schema file path should start with ${docsPackageName}, received ${packageFile}`
    );
  }
  const relativeJsonFile = packageFile.substr(docsPackageName.length);
  const filePath = path.join(REPO_DIR, 'docs', relativeJsonFile);
  return filePath;
}
