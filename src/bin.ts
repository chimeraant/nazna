#!/usr/bin/env node

import { console, io } from 'fp-ts';
import { pipe } from 'fp-ts/function';

export const main = pipe(
  io.Do,
  io.chain(() => console.log('aab')),
  io.chain(() => console.log('ccd'))
);

main();
