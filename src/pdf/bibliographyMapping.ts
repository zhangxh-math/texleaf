/*
 * TeXLeaf
 * Copyright (C) 2026 zhangxh-math
 * Licensed under GPL-3.0-only with additional attribution terms.
 * See LICENSE and NOTICE in the project root.
 */

import * as path from "node:path";
/** Resolve a literal TeX bibliography path without allowing a workspace escape. */
export function resolveProjectBibliographyPath(
  containingTexFile: string,
  requestedPath: string,
  allowedRoot: string,
): string | undefined {
  const requested = requestedPath.trim().replaceAll("/", path.sep);
  if (
    requested.length === 0 ||
    requested.length > 32_768 ||
    /[\u0000-\u001f\u007f]/u.test(requested) ||
    requested.includes("#") ||
    requested.includes("{") ||
    requested.includes("}") ||
    requested.includes("\\") && path.sep !== "\\" ||
    path.isAbsolute(requested) ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(requested)
  ) {
    return undefined;
  }
  const withExtension = /\.bib$/iu.test(requested) ? requested : `${requested}.bib`;
  const resolved = path.resolve(path.dirname(containingTexFile), withExtension);
  return isPathWithin(resolved, allowedRoot) ? resolved : undefined;
}


function isPathWithin(candidate: string, root: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}
