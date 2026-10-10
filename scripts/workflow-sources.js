// The reusable workflows run this repository's source from the toolkit action's pin
// (SWISS_KNIFE_ROOT), not from the commit the workflow file is on. A workflow that starts using a
// module, or a named export, newer than its pin fails with ERR_MODULE_NOT_FOUND or "is not a
// function" until the pins move. These helpers find, per job, every source path and named export
// a workflow takes from SWISS_KNIFE_ROOT and check them against the job's toolkit pin.

const TOOLKIT_PIN = /storybook-github-swiss-knife\/actions\/toolkit@([0-9a-f]{40})/g;

/** The jobs of a workflow as { name, text } (the lines under each `  <job>:` key). */
function jobs(workflow) {
  const lines = workflow.split('\n');
  const start = lines.indexOf('jobs:');
  if (start === -1) return [];
  const result = [];
  for (const line of lines.slice(start + 1)) {
    const name = /^ {2}([\w-]+):\s*$/.exec(line);
    if (name) result.push({ name: name[1], lines: [] });
    else if (/^\S/.test(line)) break;
    else if (result.length) result.at(-1).lines.push(line);
  }
  return result.map(({ name, lines: body }) => ({ name, text: body.join('\n') }));
}

/** Names taken from a `{ a, b: alias }` destructuring pattern. */
function destructured(pattern) {
  return pattern
    .split(',')
    .map(part => part.split(':')[0].trim())
    .filter(Boolean);
}

const ROOT = String.raw`process\.env\.SWISS_KNIFE_ROOT`;
// A path under it: `ROOT + "/src/x.js"` or the template literal `${ROOT}/src/x.js`.
const PATH_ARG = String.raw`(?:${ROOT}\s*\+\s*"\/([^"]+)"|\`\$\{\s*${ROOT}\s*\}\/([^\`$]+)\`)`;
const FORMS = {
  // Promise.all(["a.js", "b.js"].map(file => import(ROOT + "/src/" + file))).then(([{x}, {y, z}]) =>
  promiseAll: new RegExp(
    String.raw`\[([^\]]*)\]\.map\(\s*(\w+)\s*=>\s*import\(\s*${ROOT}\s*\+\s*"\/([\w./-]*\/)"\s*\+\s*\2\s*\)\s*\)\s*\)\s*\.then\(\s*\(\s*\[([^\]]*)\]\s*\)`,
    'g'
  ),
  // import(ROOT + "/src/x.js").then(({a, b}) => or .then(m => ... m.a(...)
  importThen: new RegExp(
    String.raw`import\(\s*${PATH_ARG}\s*\)\s*\.then\(\s*(?:\(\s*\{([^}]*)\}\s*\)|(\w+))\s*=>`,
    'g'
  ),
  // const {a, b} = await import(ROOT + "/src/x.js") or const m = await import(...) ... m.a(...)
  awaitImport: new RegExp(
    String.raw`(?:const|let|var)\s+(?:\{([^}]*)\}|(\w+))\s*=\s*await\s+import\(\s*${PATH_ARG}\s*\)`,
    'g'
  ),
  // node "$SWISS_KNIFE_ROOT/src/x.js" or "${SWISS_KNIFE_ROOT}/src/x.js", and any other path under it.
  shell: /\$(?:SWISS_KNIFE_ROOT|\{SWISS_KNIFE_ROOT\})\/([\w./-]*[\w-])/g
};

/** The `name.x` members a module object is used for, up to the end of its single-quoted script. */
function membersUsed(jobText, from, name) {
  const rest = jobText.slice(from);
  const end = rest.indexOf("'");
  const script = end === -1 ? rest : rest.slice(0, end);
  return [...new Set([...script.matchAll(new RegExp(String.raw`\b${name}\.(\w+)`, 'g'))].map(use => use[1]))];
}

/**
 * What a job takes from SWISS_KNIFE_ROOT: `sources` as [{ path, names }] (names: the exports it
 * reads, empty when only the file is needed), and `unrecognised`, the lines that use
 * SWISS_KNIFE_ROOT in a form none of the patterns read (YAML comments aside). An unrecognised use
 * is a problem: the check fails closed instead of skipping source it cannot see.
 */
export function swissKnifeUses(jobText) {
  const sources = [];
  const spans = [];
  for (const match of jobText.matchAll(FORMS.promiseAll)) {
    spans.push([match.index, match.index + match[0].length]);
    const files = [...match[1].matchAll(/"([^"]+)"/g)].map(file => file[1]);
    const patterns = [...match[4].matchAll(/\{([^}]*)\}/g)].map(pattern => destructured(pattern[1]));
    files.forEach((file, index) => sources.push({ path: `${match[3]}${file}`, names: patterns[index] ?? [] }));
  }
  for (const match of jobText.matchAll(FORMS.importThen)) {
    spans.push([match.index, match.index + match[0].length]);
    const names =
      match[3] !== undefined ? destructured(match[3]) : membersUsed(jobText, match.index + match[0].length, match[4]);
    sources.push({ path: match[1] ?? match[2], names });
  }
  for (const match of jobText.matchAll(FORMS.awaitImport)) {
    spans.push([match.index, match.index + match[0].length]);
    const names =
      match[1] !== undefined ? destructured(match[1]) : membersUsed(jobText, match.index + match[0].length, match[2]);
    sources.push({ path: match[3] ?? match[4], names });
  }
  for (const match of jobText.matchAll(FORMS.shell)) {
    spans.push([match.index, match.index + match[0].length]);
    sources.push({ path: match[1], names: [] });
  }
  const unrecognised = [];
  for (const use of jobText.matchAll(/SWISS_KNIFE_ROOT/g)) {
    if (spans.some(([start, end]) => use.index >= start && use.index < end)) continue;
    const lineStart = jobText.lastIndexOf('\n', use.index) + 1;
    const lineEnd = jobText.indexOf('\n', use.index);
    const line = jobText.slice(lineStart, lineEnd === -1 ? undefined : lineEnd).trim();
    if (!line.startsWith('#') && !unrecognised.includes(line)) unrecognised.push(line);
  }
  return { sources, unrecognised };
}

/** The sources a job takes from SWISS_KNIFE_ROOT (see swissKnifeUses). */
export function swissKnifeSources(jobText) {
  return swissKnifeUses(jobText).sources;
}

/** The names a module exports; `star` when it re-exports another module wholesale. */
export function exportedNames(source) {
  const names = new Set();
  for (const match of source.matchAll(/^export\s+(?:async\s+)?function\*?\s+([A-Za-z_$][\w$]*)/gm)) names.add(match[1]);
  for (const match of source.matchAll(/^export\s+(?:const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm)) names.add(match[1]);
  for (const match of source.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    for (const part of match[1].split(',')) {
      const name = part
        .trim()
        .split(/\s+as\s+/)
        .pop()
        .trim();
      if (name) names.add(name);
    }
  }
  if (/^export\s+default\b/m.test(source)) names.add('default');
  return { names, star: /^export\s+\*\s+from\b/m.test(source) };
}

/**
 * Problems with a workflow's use of SWISS_KNIFE_ROOT: a job without the toolkit, or a path or
 * named export missing at the job's toolkit pin. `readAtPin(sha, path)` returns the file's content
 * at that commit, or null when it is not there.
 */
export function checkWorkflowSources({ file, workflow, readAtPin }) {
  const problems = [];
  for (const job of jobs(workflow)) {
    const { sources, unrecognised } = swissKnifeUses(job.text);
    for (const line of unrecognised) {
      problems.push(
        `${file} job ${job.name}: unrecognised use of SWISS_KNIFE_ROOT (teach scripts/workflow-sources.js this form): ${line}`
      );
    }
    if (!sources.length) continue;
    const pins = [...new Set([...job.text.matchAll(TOOLKIT_PIN)].map(pin => pin[1]))];
    if (!pins.length) {
      problems.push(`${file} job ${job.name}: uses SWISS_KNIFE_ROOT without the toolkit action`);
      continue;
    }
    for (const pin of pins) {
      for (const { path, names } of sources) {
        const content = readAtPin(pin, path);
        if (content === null) {
          problems.push(`${file} job ${job.name}: ${path} is not at toolkit pin ${pin.slice(0, 7)}`);
          continue;
        }
        if (!names.length) continue;
        const exported = exportedNames(content);
        if (exported.star) continue;
        for (const name of names.filter(name => !exported.names.has(name))) {
          problems.push(`${file} job ${job.name}: ${path} at toolkit pin ${pin.slice(0, 7)} does not export ${name}`);
        }
      }
    }
  }
  return problems;
}
