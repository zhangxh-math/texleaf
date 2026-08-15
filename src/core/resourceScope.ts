export interface ScopedResource<T> {
  readonly scope: 'user' | 'workspace';
  readonly ownerKey?: string;
  readonly value: T;
}

/**
 * Select user-level values plus only the workspace values owned by one
 * resource. An undefined owner represents a resource outside every workspace,
 * not a wildcard. `includeAllWorkspaceValues` is reserved for aggregate UI.
 */
export function selectScopedResources<T>(
  resources: readonly ScopedResource<T>[],
  ownerKey: string | undefined,
  includeAllWorkspaceValues = false,
): T[] {
  return resources.flatMap((resource) => {
    if (resource.scope === 'user') {
      return [resource.value];
    }
    if (
      includeAllWorkspaceValues ||
      (ownerKey !== undefined && resource.ownerKey === ownerKey)
    ) {
      return [resource.value];
    }
    return [];
  });
}
