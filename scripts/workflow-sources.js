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

/**
 * The source a job takes from SWISS_KNIFE_ROOT, as [{ path, names }] (names: the exports it reads,
 * empty when only the file is needed).
 */
export function swissKnifeSources(jobText) {
  const sources = [];
  // Promise.all(["a.js", "b.js"].map(file => import(process.env.SWISS_KNIFE_ROOT + "/src/" + file))).then(([{x}, {y, z}]) =>
  for (const match of jobText.matchAll(
    /\[([^\]]*)\]\.map\(\s*(\w+)\s*=>\s*import\(process\.env\.SWISS_KNIFE_ROOT \+ "\/([\w./-]*\/)" \+ \2\)\)\)\.then\(\(\[([^\]]*)\]\)/g
  )) {
    const files = [...match[1].matchAll(/"([^"]+)"/g)].map(file => file[1]);
    const patterns = [...match[4].matchAll(/\{([^}]*)\}/g)].map(pattern => destructured(pattern[1]));
    files.forEach((file, index) => sources.push({ path: `${match[3]}${file}`, names: patterns[index] ?? [] }));
  }
  // import(process.env.SWISS_KNIFE_ROOT + "/src/x.js").then(({a, b}) => or .then(m => ... m.a(...)
  for (const match of jobText.matchAll(
    /import\(process\.env\.SWISS_KNIFE_ROOT \+ "\/([^"]+)"\)\.then\((?:\(\{([^}]*)\}\)|(\w+))\s*=>/g
  )) {
    let names = match[2] !== undefined ? destructured(match[2]) : [];
    if (match[3]) {
      // The script is single-quoted for the shell, so it ends at the next quote.
      const rest = jobText.slice(match.index + match[0].length);
      const script = rest.slice(0, rest.indexOf("'") === -1 ? undefined : rest.indexOf("'"));
      names = [...new Set([...script.matchAll(new RegExp(`\\b${match[3]}\\.(\\w+)`, 'g'))].map(use => use[1]))];
    }
    sources.push({ path: match[1], names });
  }
  // node "$SWISS_KNIFE_ROOT/src/x.js", and any other path under it.
  for (const match of jobText.matchAll(/\$SWISS_KNIFE_ROOT\/([\w./-]*[\w-])/g)) {
    sources.push({ path: match[1], names: [] });
  }
  return sources;
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
    const sources = swissKnifeSources(job.text);
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
