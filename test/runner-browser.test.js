import { test } from 'node:test';
import assert from 'node:assert/strict';

/* global window */
import { recordStoryOutcome, storyErrors, storyHasSettled } from '../runner/lib/browser.js';

/** Runs the init script against a fake window and returns an emitter for Storybook events. */
function preview() {
  const listeners = {};
  globalThis.window = {};
  globalThis.document = {
    documentElement: { setAttribute: () => {} },
    body: { classList: { contains: () => false } },
    querySelector: () => null
  };
  recordStoryOutcome('data-storybook-ci');
  window.__STORYBOOK_ADDONS_CHANNEL__ = {
    on: (event, listener) => {
      (listeners[event] ??= []).push(listener);
    }
  };
  return (event, payload) => (listeners[event] ?? []).forEach(listener => listener(payload));
}

const phase = newPhase => ['storyRenderPhaseChanged', { newPhase }];

test('a story is not settled at "completed": afterEach hooks still run after it', () => {
  const emit = preview();
  for (const name of ['preparing', 'loading', 'rendering', 'completing', 'completed', 'afterEach'])
    emit(...phase(name));
  assert.equal(storyHasSettled(), false);
  emit(...phase('finished'));
  assert.equal(storyHasSettled(), true);
  assert.deepEqual(storyErrors(), []);
});

test('Storybook 9 a11y reporter failures (a11y.test: error) are not story failures', () => {
  const emit = preview();
  emit('storyFinished', { status: 'error', reporters: [{ type: 'a11y', status: 'failed' }] });
  assert.equal(storyHasSettled(), true);
  assert.deepEqual(storyErrors(), []);
});

test('other failed reporters, and play function exceptions, are story failures', () => {
  let emit = preview();
  emit('storyFinished', {
    status: 'error',
    reporters: [
      { type: 'a11y', status: 'failed' },
      { type: 'custom', status: 'failed' }
    ]
  });
  assert.deepEqual(storyErrors(), ['Storybook reporters failed: custom']);

  emit = preview();
  emit('playFunctionThrewException', { message: 'expected 2, got 1', stack: 'Error: expected 2, got 1\n    at play' });
  emit('storyFinished', { status: 'error', reporters: [] });
  assert.deepEqual(storyErrors(), ['Error: expected 2, got 1\n    at play']);
});

test('an error status without any detail still fails the story', () => {
  const emit = preview();
  emit('storyFinished', { status: 'error' });
  assert.deepEqual(storyErrors(), ['Storybook reported an error without details']);
});
