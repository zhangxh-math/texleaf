export interface PortableSnippetRecord {
  readonly portableId: string;
  readonly trigger: string;
  readonly replacement: string;
  readonly options: string;
  readonly priority: number;
  readonly description?: string;
  readonly category: string;
  readonly flags?: string;
  readonly syntaxVersion: 1 | 2;
  readonly enabled: boolean;
}

/** Convert a namespaced runtime record back to its source-file representation. */
export function toPortableSnippetObject(
  snippet: PortableSnippetRecord,
): Record<string, unknown> {
  return {
    id: snippet.portableId,
    trigger: snippet.trigger,
    replacement: snippet.replacement,
    options: snippet.options,
    ...(snippet.priority === 0 ? {} : { priority: snippet.priority }),
    ...(snippet.description === undefined
      ? {}
      : { description: snippet.description }),
    ...(snippet.category === 'Workspace' ? {} : { category: snippet.category }),
    ...(snippet.flags === undefined ? {} : { flags: snippet.flags }),
    ...(snippet.syntaxVersion === 2
      ? {}
      : { syntaxVersion: snippet.syntaxVersion }),
    ...(snippet.enabled ? {} : { enabled: false }),
  };
}
