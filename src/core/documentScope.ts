const SUPPORTED_FILE_EXTENSIONS = [".tex", ".bib"] as const;

/**
 * Return whether a URI identifies a TeXLeaf-editable source file.
 *
 * The check deliberately uses the URI path rather than a local filesystem
 * path so it behaves the same for local files and remote/virtual workspaces.
 * Untitled editors are excluded even if a client happens to give one a
 * filename-looking path.
 */
export function isTeXLeafSourceUri(scheme: string, path: string): boolean {
  if (scheme.toLowerCase() === "untitled") {
    return false;
  }

  const lowerPath = path.toLowerCase();
  return SUPPORTED_FILE_EXTENSIONS.some((extension) =>
    lowerPath.endsWith(extension),
  );
}

/**
 * AI writing accepts ordinary local and VS Code Remote TeX files only.
 * Extension-provided virtual documents and bibliography files are excluded
 * because workspace trust is a window-level signal, not per-URI consent.
 */
export function isAIWritingSourceUri(scheme: string, path: string): boolean {
  const normalizedScheme = scheme.toLowerCase();
  return (
    (normalizedScheme === "file" || normalizedScheme === "vscode-remote") &&
    path.toLowerCase().endsWith(".tex")
  );
}
