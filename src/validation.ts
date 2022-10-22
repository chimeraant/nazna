import { apply as _apply, readonlyArray, task as T, taskEither as TE } from 'fp-ts';

export const apply = _apply.sequenceT(
  TE.getApplicativeTaskValidation(T.ApplyPar, readonlyArray.getSemigroup<unknown>())
);

export const liftTE = TE.mapLeft(readonlyArray.of);
