import { console, readonlyArray, task as T } from 'fp-ts';
import { pipe } from 'fp-ts/function';
import * as _fs from 'fs/promises';
import { match } from 'ts-pattern';

export type Config = {
  readonly name: string;
};

const cliFile = `#!/usr/bin/env node
require("./cjs/index").cli();
`;

const fs = {
  writeFile:
    (p: Parameters<typeof _fs.writeFile>): T.Task<void> =>
    () =>
      _fs.writeFile(...p),
};

export const cli: T.Task<unknown> = pipe(process.argv, readonlyArray.dropLeft(2), (argv) => {
  return match(argv)
    .with(['build', 'cli'], () => fs.writeFile(['dist/nazna', cliFile]))
    .otherwise((command) => pipe(`command not found: ${command}`, console.log, T.fromIO));
});
