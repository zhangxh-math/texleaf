"use strict";

const LEGACY_PUBLISHER_EXTENSION_ID = "local-lab.texleaf";
const LEGACY_PUBLISHER_SNIPPET_ID = "extension-host-legacy-publisher";
const LEGACY_PUBLISHER_TRIGGER = "tlegacyid";
const LEGACY_PUBLISHER_LIBRARY_TEXT = `{
  // This comment proves publisher-ID migration starts from editable JSONC.
  "version": 1,
  "variables": { "OLD_PUBLISHER": "preserved" },
  "snippets": [
    {
      "id": "${LEGACY_PUBLISHER_SNIPPET_ID}",
      "trigger": "${LEGACY_PUBLISHER_TRIGGER}",
      "replacement": "\\\\operatorname{LegacyPublisher}",
      "options": "tA"
    }
  ]
}
`;

module.exports = {
  LEGACY_PUBLISHER_EXTENSION_ID,
  LEGACY_PUBLISHER_LIBRARY_TEXT,
  LEGACY_PUBLISHER_SNIPPET_ID,
  LEGACY_PUBLISHER_TRIGGER,
};
