import fs from 'node:fs';
import path from 'node:path';

export function validateArtifactDirectory(targetPath, workspaceRoot = process.cwd()) {
  const rootAbs = path.resolve(workspaceRoot);
  if (!fs.existsSync(rootAbs)) {
    throw new Error(`Artifact validation failed: Workspace root "${rootAbs}" does not exist.`);
  }
  const rootReal = fs.realpathSync(rootAbs);

  const targetAbs = path.resolve(rootAbs, targetPath);

  // 1. Lexical Path Containment check: target must not lexically escape un-realpathed workspace root
  const relativeLexical = path.relative(rootAbs, targetAbs);
  if (relativeLexical.startsWith('..') || path.isAbsolute(relativeLexical)) {
    throw new Error(`Artifact validation failed: Path "${targetPath}" escapes workspace root "${rootAbs}".`);
  }

  // 2. Existence and Directory check
  if (!fs.existsSync(targetAbs)) {
    throw new Error(
      `Artifact validation failed: Directory "${targetPath}" does not exist at resolved path "${targetAbs}".`
    );
  }

  const targetReal = fs.realpathSync(targetAbs);

  // 3. Realpath Containment check: target realpath must not escape workspace realpath (protects against symlinks pointing outside workspace)
  const relativeReal = path.relative(rootReal, targetReal);
  if (relativeReal.startsWith('..') || path.isAbsolute(relativeReal)) {
    throw new Error(
      `Artifact validation failed: Path "${targetPath}" resolves to "${targetReal}" which escapes workspace root "${rootReal}".`
    );
  }

  const stat = fs.statSync(targetReal);
  if (!stat.isDirectory()) {
    throw new Error(`Artifact validation failed: Path "${targetPath}" is not a directory.`);
  }

  // 3. Nested .git check
  const gitDir = path.join(targetReal, '.git');
  if (fs.existsSync(gitDir)) {
    throw new Error(`Artifact validation failed: Directory "${targetPath}" contains a nested .git directory.`);
  }

  // 4. Non-empty check and file scan
  const files = readdirRecursive(targetReal, targetReal);
  if (files.length === 0) {
    throw new Error(`Artifact validation failed: Directory "${targetPath}" is empty.`);
  }

  // 5. Static content heuristic check (look for html, js, css, json, or standard storybook files)
  const hasIndexOrStatic = files.some(file => {
    const ext = path.extname(file).toLowerCase();
    const name = path.basename(file).toLowerCase();
    return (
      name === 'index.html' ||
      name === 'iframe.html' ||
      ext === '.html' ||
      ext === '.js' ||
      ext === '.json' ||
      ext === '.css'
    );
  });

  if (!hasIndexOrStatic) {
    throw new Error(
      `Artifact validation failed: Directory "${targetPath}" does not appear to contain valid static web content.`
    );
  }

  // 6. Symlink safety check (no symlinks pointing outside targetReal)
  for (const relFile of files) {
    const fullPath = path.join(targetReal, relFile);
    const lstat = fs.lstatSync(fullPath);
    if (lstat.isSymbolicLink()) {
      const realPath = fs.realpathSync(fullPath);
      const relToTarget = path.relative(targetReal, realPath);
      if (relToTarget.startsWith('..') || path.isAbsolute(relToTarget)) {
        throw new Error(
          `Artifact validation failed: Symlink "${relFile}" points outside target directory ("${realPath}").`
        );
      }
    }
  }

  return {
    valid: true,
    resolvedPath: targetReal,
    fileCount: files.length,
    files
  };
}

function readdirRecursive(dir, baseDir) {
  let results = [];
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const fullPath = path.join(dir, file);
    const relativePath = path.relative(baseDir, fullPath);
    const lstat = fs.lstatSync(fullPath);
    if (lstat.isDirectory()) {
      results = results.concat(readdirRecursive(fullPath, baseDir));
    } else {
      results.push(relativePath);
    }
  }
  return results;
}

// CLI invocation handling
if (process.argv[1] && process.argv[1].endsWith('validate-artifact.js')) {
  const targetPath = process.argv[2] || 'storybook-static';
  const workspaceRoot = process.argv[3] || process.cwd();

  try {
    const result = validateArtifactDirectory(targetPath, workspaceRoot);
    console.log(`✅ Artifact validation passed: "${targetPath}" contains ${result.fileCount} static files.`);
    process.exit(0);
  } catch (err) {
    console.error(`❌ ${err.message}`);
    process.exit(1);
  }
}
