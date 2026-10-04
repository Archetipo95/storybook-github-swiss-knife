// Dependency-free so the unit tests can import it without the runner's packages.

/**
 * Rules a story turns on or off: `a11y.config.rules` ([{ id, enabled }]) and the axe run-options
 * form `a11y.options.rules` ({ id: { enabled } }).
 * @param {any} parameters
 */
export function storyRuleSettings(parameters = {}) {
  const enabled = new Set();
  const disabled = new Set();
  const apply = (id, on) => {
    if (typeof id !== 'string') return;
    (on === false ? disabled : enabled).add(id);
    (on === false ? enabled : disabled).delete(id);
  };
  for (const rule of parameters?.a11y?.config?.rules ?? []) {
    if (rule && 'enabled' in rule) apply(rule.id, rule.enabled);
  }
  for (const [id, rule] of Object.entries(parameters?.a11y?.options?.rules ?? {})) {
    if (rule && typeof rule === 'object' && 'enabled' in rule) apply(id, rule.enabled);
  }
  return { enabled, disabled };
}
