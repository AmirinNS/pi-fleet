# src/vendor/

Vendored, MIT-licensed code adapted from other projects. One subdirectory per
source module. Rules:

- Keep the original MIT header + copyright on every copied file.
- Rewire dependencies to upstream pi (`@earendil-works/pi-*`) / Node — no
  `@oh-my-pi/*`, no Bun-only APIs, no native fork modules.
- Register every module in the repo-root `THIRD_PARTY.md` with its source commit.

Nothing is vendored yet — this directory exists so the policy is in place before
the first port.
