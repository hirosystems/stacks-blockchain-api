import * as path from 'path';
import Ajv from 'ajv';
import * as RefParser from '@apidevtools/json-schema-ref-parser';
import { getOrAddAsync, REPO_DIR } from '../helpers';
import { logger } from '../logger';

const derefSchemaCache: Map<string, RefParser.JSONSchema> = new Map();
export async function dereferenceSchema(schemaFilePath: string): Promise<RefParser.JSONSchema> {
  return getOrAddAsync(derefSchemaCache, schemaFilePath, () =>
    RefParser.dereference(schemaFilePath)
  );
}

export function getDocSchemaFile(packageFile: string) {
  const filePath = path.join(REPO_DIR, 'src/rosetta/json-schemas', packageFile);
  return filePath;
}
