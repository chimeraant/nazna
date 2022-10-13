import { console, io } from 'fp-ts';
import { pipe } from 'fp-ts/function';

const mkMain = (argv: readonly string[]) =>
  pipe(
    io.Do,
    io.chain(() => console.log(argv)),
    io.chain(() => console.log('ccd'))
  );

const main = mkMain(process.argv);

main();
