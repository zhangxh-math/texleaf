# quiver bundled source

Upstream: https://github.com/varkor/quiver
Commit: 2f289ecbae9b7e5a473e04b924750c538ed5c4cf (1.7.0).
License: MIT; original copyright and license are in LICENSE.
KaTeX: 0.18.1, the version pinned by the upstream Makefile; see KaTeX/LICENSE.

TexLeaf-Z integration patches bundle KaTeX and icons locally, expose an application-ready event,
use canonical exported URLs, disable the first-use pane and stored remote-renderer settings, and disable trusted KaTeX commands. Chinese controls and the
editor bridge live in src/quiver; original diagram rendering and manipulation are retained.

The build emits a self-contained editor.html with local fonts, icons and a nonce-bound script.
It makes no network requests at runtime. quiver.sty is also supplied for isolated TeX previews.

The parser preserves supported tikz-cd row/column separation and cramped options.
Unsupported units or values produce conversion diagnostics instead of being silently discarded.
