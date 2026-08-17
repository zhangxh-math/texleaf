export type AiWritingLanguagePreference = "auto" | "english" | "chinese";

/**
 * Convert the user-facing language preference into the short protocol label
 * accepted by both AI clients. Output-language instructions belong in the
 * system prompt rather than this bounded label.
 */
export function aiWritingLanguageLabel(
  preference: AiWritingLanguagePreference,
): "auto" | "English" | "Chinese" {
  switch (preference) {
    case "english":
      return "English";
    case "chinese":
      return "Chinese";
    case "auto":
      return "auto";
  }
}
