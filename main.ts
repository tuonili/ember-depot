// Ember Depot, entered in make.fun's threejs-fps-02 bounty: this program hands in the game beside it.
// Node 22, the standard library only, no build step. It copies game/ and screenshots/ to /output and
// writes /output/dossier.json — the summary the judge reads — with the vendored make.fun library, so
// the dossier is exactly what the bounty's own scorer would write from the same files.
//
// Play it locally with `node serve.ts` and open http://localhost:8080.
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(out, { recursive: true });
cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
if (existsSync(join(here, 'screenshots'))) {
  cpSync(join(here, 'screenshots'), join(out, 'screenshots'), { recursive: true });
}

// The scorer's own caps (its gate.json). Only text_max_bytes shapes the bytes; the rest refuse an
// entry the scorer would refuse: more than four screenshots or one over 256 KiB, more than 993
// entries under game/ or 48 MiB of game files.
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
  }),
);
