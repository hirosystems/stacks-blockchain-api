import * as path from 'path';
import * as Ajv from 'ajv';
import * as RefParser from '@apidevtools/json-schema-ref-parser';
import { getOrAddAsync, REPO_DIR } from '../helpers';
import { logger } from '../logger';

const derefSchemaCache: Map<string, RefParser.JSONSchema> = new Map();
export async function dereferenceSchema(schemaFilePath: string): Promise<RefParser.JSONSchema> {
  return getOrAddAsync(derefSchemaCache, schemaFilePath, () =>
    RefParser.dereference(schemaFilePath)
  );
}

export async function validate(schemaFilePath: string, data: any) {
  if (process.env.NODE_ENV !== 'development') return;
  const resolvedFilePath = getDocSchemaFile(schemaFilePath);
  const schemaDef = await dereferenceSchema(resolvedFilePath);
  const ajv = new Ajv({ schemaId: 'auto' });
  const valid = await ajv.validate(schemaDef, data);
  if (!valid) {
    logger.warn(`Schema validation:\n\n ${JSON.stringify(ajv.errors, null, 2)}`);
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
