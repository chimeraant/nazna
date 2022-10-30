import { summonFor } from '@morphic-ts/batteries/lib/summoner-ESBST';
import type {} from '@morphic-ts/model-algebras/lib/types';
import type { AType } from '@morphic-ts/summoners';

const { summon } = summonFor({});

export const ReleaseYamlSteps = summon((F) =>
  F.array(
    F.intersection(
      F.interface({ name: F.string() }, 'release.yaml steps'),
      F.strMap(F.unknown())
    )('Step')
  )
);

export type ReleaseYamlSteps = AType<typeof ReleaseYamlSteps>;

export const ReleaseYamlFile = summon((F) =>
  F.interface(
    {
      name: F.stringLiteral('Release'),
      on: F.interface(
        {
          push: F.interface(
            {
              branches: F.stringLiteral('main'),
            },
            'push'
          ),
          pull_request: F.interface(
            {
              branches: F.stringLiteral('main'),
            },
            'pull_request'
          ),
        },
        'on'
      ),
      jobs: F.interface(
        {
          release: F.interface(
            {
              name: F.stringLiteral('Release'),
              'runs-on': F.stringLiteral('ubuntu-latest'),
              steps: ReleaseYamlSteps(F),
            },
            'release.yaml jobs release'
          ),
        },
        'release.yaml jobs'
      ),
    },
    'release.yaml'
  )
);

export type ReleaseYamlFile = AType<typeof ReleaseYamlFile>;

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
