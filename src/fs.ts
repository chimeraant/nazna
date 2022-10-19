import { summonFor } from '@morphic-ts/batteries/lib/summoner-ESBST';
import { taskEither as TE } from 'fp-ts';
import { identity } from 'fp-ts/function';
import { Mode } from 'fs';
import * as _fs from 'fs/promises';
import * as pathModule from 'path';

const { summon } = summonFor({});

const ReadFileError = summon((F) =>
  F.interface(
    {
      code: F.stringLiteral('ENOENT'),
    },
    'ENOENT'
  )
);

type ReadFileErr =
  | {
      readonly code: 'unknown';
      readonly value: unknown;
    }
  | {
      readonly code: 'ENOENT';
    };

const mapReadFileErr = (err: unknown): ReadFileErr =>
  ReadFileError.type.is(err) ? err : { code: 'unknown', value: err };

export const fs = {
  writeFile: (path: readonly string[]) => (data: string) =>
    TE.tryCatch(
      () => _fs.writeFile(pathModule.join(...path), data, { encoding: 'utf8' }),
      identity
    ),
  readFile: (path: readonly string[]) =>
    TE.tryCatch(() => _fs.readFile(pathModule.join(...path), 'utf8'), mapReadFileErr),
  mkDir: (path: readonly string[]) =>
    TE.tryCatch(() => _fs.mkdir(pathModule.join(...path), { recursive: true }), identity),
  chmod: (path: readonly string[], mode: Mode) =>
    TE.tryCatch(() => _fs.chmod(pathModule.join(...path), mode), identity),
};
