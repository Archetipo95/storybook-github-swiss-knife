import { test } from 'node:test';
import assert from 'node:assert/strict';

import { dockerArgs, parseArgs } from '../runner/cli.js';

test('parseArgs: commands and options', () => {
  assert.deepEqual(parseArgs(['visual', '--update', '--storybook', 'dist/sb', '--shard', '2/3', '--docker']), {
    command: 'visual',
    update: true,
    updateBaseline: false,
    docker: true,
    storybook: 'dist/sb',
    shard: '2/3'
  });
  assert.equal(parseArgs(['a11y', '--update-baseline']).updateBaseline, true);
  assert.throws(() => parseArgs(['nope']), /Usage/);
  assert.throws(() => parseArgs(['a11y']), /--update-baseline/);
  assert.throws(() => parseArgs(['visual', '--fast']), /Unknown option: --fast/);
});

test('dockerArgs runs the same command in the Playwright image of the runner version', () => {
  const args = dockerArgs({
    projectDir: '/work/app',
    args: ['visual', '--docker', '--update'],
    version: '1.63.0',
    uid: 501,
    gid: 20
  });
  assert.equal(args[args.indexOf('-w') + 1], '/project');
  assert.ok(args.includes('/work/app:/project'));
  assert.ok(
    args.some(arg => /:\/swiss-knife:ro$/.test(arg)),
    'swiss-knife is mounted read-only'
  );
  assert.ok(args.includes('mcr.microsoft.com/playwright:v1.63.0-noble'));
  assert.deepEqual(args.slice(args.indexOf('/swiss-knife/runner/cli.js') + 1), ['visual', '--update']);
  assert.equal(args[args.indexOf('--user') + 1], '501:20');
});
