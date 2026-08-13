// Shared <dialog> rendering for any event-like object in Storm Chaser — NWS
// alerts, tropical systems, and LIVE EARTH global events all funnel through
// this one module and the one #alertDialog element already approved for
// Phase 2/3, rather than each feature inventing its own detail panel.
// Callers never touch the dialog DOM directly; they build a small "view
// model" describing what to show and hand it to openEventDialog().

const elements = {
  dialog: document.querySelector("#alertDialog"),
  close: document.querySelector("#closeAlertDialog"),
  severity: document.querySelector("#alertDialogSeverity"),
  title: document.querySelector("#alertDialogTitle"),
  headline: document.querySelector("#alertDialogHeadline"),
  meta: document.querySelector("#alertDialogMeta"),
  eyebrow: document.querySelector("#alertDialogEyebrow"),
  areaHeading: document.querySelector("#alertDialogAreaHeading"),
  area: document.querySelector("#alertDialogArea"),
  descriptionHeading: document.querySelector("#alertDialogDescriptionHeading"),
  description: document.querySelector("#alertDialogDescription"),
  instructionHeading: document.querySelector("#alertDialogInstructionHeading"),
  instruction: document.querySelector("#alertDialogInstruction"),
  instructionSection: document.querySelector("#alertInstructionSection"),
  authority: document.querySelector("#alertDialogAuthority"),
  source: document.querySelector("#alertDialogSource"),
  saveButton: document.querySelector("#dialogSaveButton"),
  shareButton: document.querySelector("#dialogShareButton"),
};

let onCloseCallback = null;
let onSaveCallback = null;
let onShareCallback = null;

elements.close.addEventListener("click", () => elements.dialog.close());
elements.dialog.addEventListener("click", (event) => {
  if (event.target === elements.dialog) elements.dialog.close();
});
elements.dialog.addEventListener("close", () => {
  const callback = onCloseCallback;
  onCloseCallback = null;
  if (typeof callback === "function") callback();
});

elements.saveButton.addEventListener("click", () => {
  if (typeof onSaveCallback !== "function") return;
  setSaveButtonState(onSaveCallback());
});

elements.shareButton.addEventListener("click", () => {
  if (typeof onShareCallback === "function") onShareCallback();
});

function setSaveButtonState(isSaved) {
  elements.saveButton.setAttribute("aria-pressed", String(Boolean(isSaved)));
  elements.saveButton.setAttribute("aria-label", isSaved ? "Remove from saved events" : "Save event");
}

/**
 * @param {Object} model
 * @param {string} model.level - one of the 4 existing severity CSS tiers (critical/severe/elevated/advisory)
 * @param {string} model.eyebrow
 * @param {string} model.severityLabel
 * @param {string} model.title
 * @param {string} model.headline
 * @param {string} [model.areaHeading]
 * @param {string} model.area
 * @param {string} [model.descriptionHeading]
 * @param {string} model.description
 * @param {string} [model.instructionHeading]
 * @param {string} [model.instruction] - section hidden entirely when omitted
 * @param {string} model.authority
 * @param {string} [model.sourceUrl]
 * @param {Array<[string, string]>} model.fields - meta grid [label, value] pairs
 * @param {Function} [onSave] - if provided, shows the save/bookmark button; called on click, must return the new isSaved state
 * @param {boolean} [isSaved] - initial pressed state for the save button
 * @param {Function} [onShare] - if provided, shows the share/copy-link button
 */
export function openEventDialog(model, { onClose, onSave, isSaved, onShare } = {}) {
  onCloseCallback = onClose || null;
  onSaveCallback = onSave || null;
  onShareCallback = onShare || null;

  elements.saveButton.hidden = typeof onSave !== "function";
  if (typeof onSave === "function") setSaveButtonState(isSaved);

  elements.shareButton.hidden = typeof onShare !== "function";

  elements.dialog.className = `alert-dialog alert-card--${model.level}`;
  elements.eyebrow.textContent = model.eyebrow;
  elements.severity.textContent = model.severityLabel;
  elements.title.textContent = model.title;
  elements.headline.textContent = model.headline;
  elements.areaHeading.textContent = model.areaHeading || "Location";
  elements.area.textContent = model.area;
  elements.descriptionHeading.textContent = model.descriptionHeading || "Description";
  elements.description.textContent = model.description;
  elements.instructionHeading.textContent = model.instructionHeading || "Details";
  elements.instruction.textContent = model.instruction || "";
  elements.instructionSection.hidden = !model.instruction;
  elements.authority.textContent = model.authority;
  elements.source.href = isSafeHttpUrl(model.sourceUrl) ? model.sourceUrl : "#";

  elements.meta.replaceChildren();
  (model.fields || []).forEach(([label, value]) => {
    const item = document.createElement("div");
    const labelEl = document.createElement("span");
    labelEl.textContent = label;
    const valueEl = document.createElement("strong");
    valueEl.textContent = value || "Unavailable";
    item.append(labelEl, valueEl);
    elements.meta.append(item);
  });

  if (elements.dialog.open) elements.dialog.close();
  elements.dialog.showModal();
}

// Source URLs come from provider payloads (NWS/NHC/USGS/NASA/GDACS) — always
// https in practice, but this is the one place they land in a live href, so
// guard the scheme rather than trust every provider response indefinitely.
function isSafeHttpUrl(url) {
  if (!url) return false;
  try {
    return ["http:", "https:"].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

export function closeEventDialog() {
  if (elements.dialog.open) elements.dialog.close();
}
