export type OptimisticRevisionStatus = "committed" | "changed";

/**
 * A successful write operation is not enough to acknowledge a UI save: the
 * exact bytes read back afterwards must still be the bytes the UI requested.
 */
export function optimisticRevisionStatus(
  desiredRevision: string,
  observedRevision: string,
): OptimisticRevisionStatus {
  return desiredRevision === observedRevision ? "committed" : "changed";
}
