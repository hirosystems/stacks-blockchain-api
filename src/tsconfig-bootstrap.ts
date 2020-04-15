import * as tsConfig from '../tsconfig.json';
import * as tsConfigPaths from 'tsconfig-paths';

const baseUrl = '.';
const cleanup = tsConfigPaths.register({
  baseUrl,
  paths: tsConfig.compilerOptions.paths,
});

cleanup();
