import { build } from 'esbuild';

// Storybook bundles manager entries and maps these imports to the manager's own copies.
const external = ['react', 'react-dom', '@storybook/*', 'storybook', 'storybook/*'];

await Promise.all(
  ['manager-sb8', 'manager-modern'].map(name =>
    build({
      entryPoints: [`src/${name}.jsx`],
      outfile: `dist/${name}.js`,
      bundle: true,
      format: 'esm',
      platform: 'browser',
      target: 'es2020',
      jsx: 'transform',
      jsxFactory: 'React.createElement',
      jsxFragment: 'React.Fragment',
      external,
      absWorkingDir: import.meta.dirname,
      logLevel: 'warning'
    })
  )
);
console.log('Built dist/manager-sb8.js and dist/manager-modern.js');
