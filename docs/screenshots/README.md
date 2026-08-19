# Screenshots

These are the four views over the board that `pnpm db:seed` creates, so the
images in the README and the board you get on a fresh install are the same
thing. Regenerating them means seeding a database, running a production build
(`pnpm build && pnpm start`, so the dev-tools overlay is absent), signing in,
and capturing each view at 1440 wide with a device pixel ratio of 2.

Shot against a production server rather than `pnpm dev` on purpose: the dev
build paints an overlay in the corner that has no business in a screenshot.
