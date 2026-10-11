// The simple YAML of the legacy `.storybook-pages.yml`: top-level `key: value` pairs, one level
// of nested sections and block scalars. Shared by the swiss-knife workflows (src/config.js) and
// `storybook-swiss-knife init`, which moves the file under "pages" in .storybook/swiss-knife.json.

function rejectUnsafeYamlKey(key) {
  throw new Error(`Configuration key "${key}" is not allowed`);
}

export function parseSimpleYaml(content) {
  const result = {};
  let currentSection = null;

  const lines = content.split(/\r?\n/);
  const parseBlockScalar = (startIndex, { allowNested = false } = {}) => {
    const block = [];
    let index = startIndex + 1;

    while (index < lines.length) {
      const rawLine = lines[index];
      if (!rawLine || !rawLine.trim()) {
        block.push('');
        index += 1;
        continue;
      }

      const indent = rawLine.search(/\S/);
      if (allowNested ? indent > 0 : indent >= 0) {
        if (indent === 0) break;
        block.push(rawLine.slice(indent));
        index += 1;
        continue;
      }
      break;
    }

    return { value: block.join('\n').replace(/\n$/, ''), nextIndex: index };
  };

  for (let index = 0; index < lines.length; index++) {
    let line = lines[index];
    const commentIdx = line.indexOf('#');
    if (commentIdx !== -1) {
      line = line.slice(0, commentIdx);
    }
    if (!line.trim()) continue;

    const indent = line.search(/\S/);
    const trimmed = line.trim();

    if (indent === 0) {
      currentSection = null;
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx !== -1) {
        const key = trimmed.slice(0, colonIdx).trim();
        // Keys that would write to Object.prototype instead of an own property.
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') rejectUnsafeYamlKey(key);
        let val = trimmed.slice(colonIdx + 1).trim();
        if (val === '|' || val === '>' || /^([|>])([+-]?)$/.test(val)) {
          const { value, nextIndex } = parseBlockScalar(index, { allowNested: false });
          result[key] = value;
          index = nextIndex - 1;
          continue;
        }
        if (val) {
          result[key] = parseValue(val);
        } else {
          result[key] = {};
          currentSection = key;
        }
      }
    } else if (indent > 0 && currentSection) {
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx !== -1) {
        const key = trimmed.slice(0, colonIdx).trim();
        // Keys that would write to Object.prototype instead of an own property.
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') rejectUnsafeYamlKey(key);
        let val = trimmed.slice(colonIdx + 1).trim();
        if (val === '|' || val === '>' || /^([|>])([+-]?)$/.test(val)) {
          const { value, nextIndex } = parseBlockScalar(index, { allowNested: true });
          result[currentSection][key] = value;
          index = nextIndex - 1;
          continue;
        }
        result[currentSection][key] = parseValue(val);
      }
    }
  }

  return result;
}

function parseValue(val) {
  if (val === 'true') return true;
  if (val === 'false') return false;
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    return val.slice(1, -1);
  }
  if (val !== '' && !isNaN(Number(val))) return Number(val);
  return val;
}
