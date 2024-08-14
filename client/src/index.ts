import { default as createOpenApiClient, ClientOptions } from "openapi-fetch";
import type { paths } from "./generated/schema";
import { BASE_PATH } from "./common";

export function createClient(options?: ClientOptions) {
  return createOpenApiClient<paths>({ baseUrl: BASE_PATH, ...options });
}

export * from './common';
export * from './socket-io';
export * from './ws';
export type * from './types';
export * from 'openapi-fetch';
