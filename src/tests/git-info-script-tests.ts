import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawnSync, execSync } from 'child_process';

describe('git info script', () => {
  test('error when git repo data not available', () => {
    const scriptFilePath = path.resolve('git-info-generator.mjs');
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stacks-api-test-'));
    const result = spawnSync(`node "${scriptFilePath}"`, {
      cwd: tempDir,
      shell: true,
      encoding: 'utf8',
    });
    expect(result.status).toStrictEqual(1);
    expect(result.stderr).toEqual(expect.stringContaining('not a git repository'));
  });

  test('error when no git tags found', () => {
    const scriptFilePath = path.resolve('git-info-generator.mjs');
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stacks-api-test-'));
    execSync(
      'git init && git config user.name test && git config user.email test && git commit --allow-empty -n -m test',
      { cwd: tempDir }
    );
    const result = spawnSync(`node "${scriptFilePath}"`, {
      cwd: tempDir,
      shell: true,
      encoding: 'utf8',
    });
    expect(result.status).toStrictEqual(1);
    expect(result.stderr).toEqual(expect.stringContaining('no tag found'));
  });

  test('generates get info file correctly', () => {
    const scriptFilePath = path.resolve('git-info-generator.mjs');
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stacks-api-test-'));
    execSync(
      'git init && git config user.name test && git config user.email test && git commit --allow-empty -n -m test && git tag v1.2.3 && git branch -m my_branch',
      { cwd: tempDir }
    );
    const result = spawnSync(`node "${scriptFilePath}"`, {
      cwd: tempDir,
      shell: true,
      encoding: 'utf8',
    });
    expect(result.status).toStrictEqual(0);
    const gitInfoFilePath = path.join(tempDir, '.git-info');
    expect(fs.existsSync(gitInfoFilePath));
    const gitInfoContent = fs.readFileSync(gitInfoFilePath, { encoding: 'utf8' });
    const gitInfoParts = gitInfoContent.split('\n');
    expect(gitInfoParts[0]).toStrictEqual('my_branch');
    expect(gitInfoParts[1]).toBeTruthy();
    expect(gitInfoParts[2]).toStrictEqual('v1.2.3');
  });
});
