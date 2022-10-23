import { summonFor } from '@morphic-ts/batteries/lib/summoner-ESBST';
import type {} from '@morphic-ts/model-algebras/lib/types';
import type { AType } from '@morphic-ts/summoners';

const { summon } = summonFor({});

export const ReleaseYamlFile = summon((F) => F.strMap(F.unknown()));

export const PackageJson = summon((F) =>
  F.partial(
    {
      dependencies: F.strMap(F.string()),
      devDependencies: F.strMap(F.string()),
      scripts: F.strMap(F.string()),
      nazna: F.partial(
        {
          flake: F.nonEmptyArray(F.string()),
        },
        'naznaConfig'
      ),
    },
    'package.json'
  )
);

export type PackageJson = AType<typeof PackageJson>;
