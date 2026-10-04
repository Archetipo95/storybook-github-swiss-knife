import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { storyRuleSettings } from '../runner/lib/a11y-rules.js';
import { resolveStaticPath } from '../runner/lib/serve.js';
import { hostResolverRules } from '../runner/lib/settings.js';
import { resolveViewport, selectedViewport } from '../runner/lib/viewport.js';

const config = { viewports: 'storybook', defaultViewport: { width: 1280, height: 720 } };
const custom = { styles: { width: '375px', height: '812px' } };

test('Storybook 8: defaultViewport name looked up in parameters.viewport.viewports', () => {
  const story = { parameters: { viewport: { viewports: { phone: custom }, defaultViewport: 'phone' } } };
  assert.deepEqual(resolveViewport(story, config), { width: 375, height: 812, name: 'phone' });
});

test('Storybook 9/10: the viewport global selects from parameters.viewport.options, with rotation', () => {
  const story = {
    parameters: { viewport: { options: { phone: custom } } },
    globals: { viewport: { value: 'phone', isRotated: true } }
  };
  assert.deepEqual(resolveViewport(story, config), { width: 812, height: 375, name: 'phone' });
  assert.deepEqual(selectedViewport({ globals: { viewport: 'phone' } }), { name: 'phone', isRotated: false });
});

test("Storybook's built-in viewport names work without a project list", () => {
  assert.deepEqual(resolveViewport({ globals: { viewport: { value: 'mobile1' } } }, config), {
    width: 320,
    height: 568,
    name: 'mobile1'
  });
});

test('no viewport, responsive, unknown names and percentage sizes fall back to the default', () => {
  const fallback = { width: 1280, height: 720, name: 'default' };
  assert.deepEqual(resolveViewport({}, config), fallback);
  assert.deepEqual(resolveViewport({ globals: { viewport: { value: 'responsive' } } }, config), fallback);
  assert.deepEqual(resolveViewport({ globals: { viewport: { value: 'nope' } } }, config), fallback);
  const percent = {
    parameters: { viewport: { options: { full: { styles: { width: '100%', height: '100%' } } } } },
    globals: { viewport: { value: 'full' } }
  };
  assert.deepEqual(resolveViewport(percent, config), fallback);
});

test('config: a name list restricts viewports, a size map overrides Storybook', () => {
  const story = { globals: { viewport: { value: 'mobile1' } } };
  assert.equal(resolveViewport(story, { ...config, viewports: ['tablet'] }).name, 'default');
  assert.deepEqual(resolveViewport(story, { ...config, viewports: { mobile1: { width: 360, height: 640 } } }), {
    width: 360,
    height: 640,
    name: 'mobile1'
  });
});

test('static server never resolves paths outside the Storybook directory', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'serve-'));
  fs.writeFileSync(path.join(root, 'index.json'), '{}');
  fs.mkdirSync(path.join(root, 'docs'));
  fs.writeFileSync(path.join(root, 'docs/index.html'), '<p>');
  assert.equal(resolveStaticPath(root, '/index.json?x=1'), path.join(root, 'index.json'));
  assert.equal(resolveStaticPath(root, '/docs/'), path.join(root, 'docs/index.html'));
  for (const attempt of ['/../etc/passwd', '/%2e%2e/%2e%2e/etc/passwd', '/docs/../../secret', '/%E0%A4%A']) {
    const resolved = resolveStaticPath(root, attempt);
    assert.ok(resolved === null || resolved.startsWith(root), attempt);
  }
  assert.equal(resolveStaticPath(root, '/missing.js'), null);
});

test('host resolver rules always keep localhost and add the allowed hosts', () => {
  assert.equal(
    hostResolverRules(['fonts.gstatic.com']),
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost, EXCLUDE fonts.gstatic.com'
  );
});

test("Storybook 8 with the viewport addon: the 'reset' global falls back to the story's defaultViewport", () => {
  const story = { parameters: { viewport: { defaultViewport: 'mobile1' } }, globals: { viewport: 'reset' } };
  assert.deepEqual(resolveViewport(story, config), { width: 320, height: 568, name: 'mobile1' });
  assert.deepEqual(resolveViewport({ globals: { viewport: 'reset' } }, config).name, 'default');
});

test('story a11y rules: config.rules list and options.rules map, later settings win', () => {
  const { enabled, disabled } = storyRuleSettings({
    a11y: {
      config: {
        rules: [
          { id: 'region', enabled: true },
          { id: 'color-contrast', enabled: false }
        ]
      },
      options: { rules: { 'heading-order': { enabled: false }, region: { enabled: false } } }
    }
  });
  assert.deepEqual([...enabled], []);
  assert.deepEqual([...disabled].sort(), ['color-contrast', 'heading-order', 'region']);
  assert.deepEqual(
    [...storyRuleSettings({ a11y: { config: { rules: [{ id: 'region', enabled: true }] } } }).enabled],
    ['region']
  );
});
