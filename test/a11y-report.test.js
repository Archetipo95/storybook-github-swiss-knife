import { test } from 'node:test';
import assert from 'node:assert/strict';

import { A11Y_COMMENT_MARKER, buildBaseline, evaluateA11yReports, renderA11ySummary } from '../src/a11y/report.js';

const contrast = nodes => ({
  id: 'color-contrast',
  impact: 'serious',
  help: 'Elements must meet minimum color contrast ratio thresholds',
  helpUrl: 'https://dequeuniversity.com/rules/axe/4.13/color-contrast',
  nodes
});
const buttonName = { id: 'button-name', impact: 'critical', help: 'Buttons must have discernible text', nodes: 1 };
const headingOrder = { id: 'heading-order', impact: 'moderate', help: 'Heading levels increase by one', nodes: 1 };

const baseline = { stories: { 'card--default': { 'color-contrast': 4 } } };

test('a baselined rule blocks only when it fails on more nodes than recorded', () => {
  const same = evaluateA11yReports([{ id: 'card--default', violations: [contrast(4)] }], { baseline });
  const fewer = evaluateA11yReports([{ id: 'card--default', violations: [contrast(2)] }], { baseline });
  const more = evaluateA11yReports([{ id: 'card--default', violations: [contrast(5)] }], { baseline });
  assert.equal(same.blocking.length, 0);
  assert.equal(fewer.blocking.length, 0);
  assert.deepEqual(
    more.blocking.map(({ story, id, nodes }) => [story, id, nodes]),
    [['card--default', 'color-contrast', 5]]
  );
});

test('a new story inherits nothing from its siblings: any blocking-impact violation is new', () => {
  const { blocking } = evaluateA11yReports([{ id: 'card--new', violations: [contrast(1)] }], { baseline });
  assert.equal(blocking.length, 1);
});

test('non-blocking impacts never block unless the rule is enforced', () => {
  const free = evaluateA11yReports([{ id: 'page--a', violations: [headingOrder] }], { baseline });
  const enforced = evaluateA11yReports([{ id: 'page--a', violations: [headingOrder] }], {
    baseline,
    enforcedRules: ['heading-order']
  });
  assert.equal(free.blocking.length, 0);
  assert.equal(enforced.blocking.length, 1);
});

test('enforced rules block whatever the baseline says, from config or from the baseline file', () => {
  const lenientBaseline = { enforcedRules: ['button-name'], stories: { 'nav--menu': { 'button-name': 10 } } };
  const { blocking, enforcedRules } = evaluateA11yReports([{ id: 'nav--menu', violations: [buttonName] }], {
    baseline: lenientBaseline,
    enforcedRules: ['label']
  });
  assert.equal(blocking.length, 1);
  assert.deepEqual(enforcedRules, ['button-name', 'label']);
});

test('the runner cannot mark its own violations as not new', () => {
  const spoofed = { id: 'card--x', violations: [{ ...contrast(3), isNew: false }] };
  assert.equal(evaluateA11yReports([spoofed], { baseline }).blocking.length, 1);
});

test('blockingImpacts is configurable', () => {
  const report = [{ id: 'card--x', violations: [contrast(1)] }];
  assert.equal(evaluateA11yReports(report, { blockingImpacts: ['critical'] }).blocking.length, 0);
});

test('buildBaseline records node counts, skips enforced rules and empty stories, sorted', () => {
  const built = buildBaseline(
    [
      { id: 'z--story', violations: [contrast(2), buttonName] },
      { id: 'a--story', violations: [headingOrder, contrast(1)] },
      { id: 'm--clean', violations: [buttonName] }
    ],
    ['button-name']
  );
  assert.deepEqual(built, {
    enforcedRules: ['button-name'],
    stories: {
      'a--story': { 'color-contrast': 1, 'heading-order': 1 },
      'z--story': { 'color-contrast': 2 }
    }
  });
  assert.deepEqual(Object.keys(built.stories), ['a--story', 'z--story']);
});

test('summary: marker, table per rule and the list of new violations', () => {
  const evaluation = evaluateA11yReports(
    [
      { id: 'card--default', violations: [contrast(4)] },
      { id: 'card--new', violations: [contrast(2)] }
    ],
    { baseline }
  );
  const markdown = renderA11ySummary(evaluation);
  assert.ok(markdown.startsWith(A11Y_COMMENT_MARKER));
  assert.match(markdown, /:x: 1 new accessibility violation\./);
  assert.match(
    markdown,
    /\| serious \| \[color-contrast\]\(https:\/\/dequeuniversity\.com[^)]*\) \| .* \| 2 \| 6 \| 1 \|/
  );
  assert.match(markdown, /- `card--new`: color-contrast \(2 nodes\)/);
});

test('summary with no violations', () => {
  const markdown = renderA11ySummary(evaluateA11yReports([], { baseline }));
  assert.match(markdown, /No new accessibility violations/);
  assert.match(markdown, /0 stories with violations/);
  assert.doesNotMatch(markdown, /\| Impact \|/);
});
