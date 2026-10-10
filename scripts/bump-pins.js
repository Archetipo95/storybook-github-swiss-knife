// `npm run bump-pins`: moves the internal action pins to the branch's merge base with main,
// without a release (no version or changelog change). For a PR whose workflows start using src
// that is already on main: see "Workflows and the pinned toolkit" in docs/development.md.

import { moveInternalPins } from './internal-pins.js';

try {
  const pinSha = moveInternalPins({ purpose: 'moving the pins' });
  console.log(`Moved internal action pins -> ${pinSha}`);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
