import { readonlyArray, string } from 'fp-ts';
import { flow } from 'fp-ts/function';
import * as std from 'fp-ts-std';

export const multiline = flow(
  string.split('\n'),
  readonlyArray.dropLeft(1),
  readonlyArray.dropRight(1),
  readonlyArray.toArray,
  std.array.join('')
);
