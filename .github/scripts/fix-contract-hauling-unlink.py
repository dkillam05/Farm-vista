from pathlib import Path

# 1) Hauling Jobs: allow linked contracts to be dragged back into
#    the Unlinked Contracts list itself (desktop + touch).
path = Path('js/grain-hauling-jobs.js')
text = path.read_text()

start = text.find('function setupUnassignDrop() {')
end = text.find('function beginPointerHold(', start)
if start == -1 or end == -1:
    raise SystemExit('Could not locate setupUnassignDrop block')

replacement = '''function setupUnassignDrop() {

  const targets = [
    $("hauling-unassign-drop"),
    $("hauling-unlinked-contract-list")
  ].filter(Boolean);

  targets.forEach(
    target => {

      if (
        target.dataset.haulingUnassignBound ===
          "1"
      ) {
        return;
      }

      target.dataset.haulingUnassignBound =
        "1";

      target.addEventListener(
        "dragover",
        event => {

          const contract =
            state.contracts.find(
              item =>
                item.id ===
                state.draggingContractId
            );

          if (
            !contract ||
            !clean(
              contract?.haulingJobId
            )
          ) {
            return;
          }

          event.preventDefault();
          clearDndHighlights();
          target.classList.add(
            "drag-over"
          );
        }
      );

      target.addEventListener(
        "dragleave",
        event => {
          if (
            !event.relatedTarget ||
            !target.contains(
              event.relatedTarget
            )
          ) {
            target.classList.remove(
              "drag-over"
            );
          }
        }
      );

      target.addEventListener(
        "drop",
        async event => {

          event.preventDefault();

          const contractId =
            state.draggingContractId ||
            clean(
              event.dataTransfer
                ?.getData(
                  "text/plain"
                )
            );

          clearDndHighlights();

          if (
            contractId
          ) {
            await unlinkContract(
              contractId
            );
          }
        }
      );
    }
  );
}


'''

text = text[:start] + replacement + text[end:]

old_touch = '''  const unassign =
    targetElement.closest(
      "#hauling-unassign-drop"
    );'''
new_touch = '''  const unassign =
    targetElement.closest(
      "#hauling-unassign-drop, #hauling-unlinked-contract-list"
    );'''
if old_touch not in text:
    raise SystemExit('Could not locate touch unassign selector')
text = text.replace(old_touch, new_touch, 1)

text = text.replace(
    'Drag a contract from the left onto the correct hauling job. Location is checked when you drop it.',
    'Drag an unlinked contract onto the correct hauling job. To undo a link, drag the linked contract back into Unlinked Contracts. Location is checked when you drop it.'
)
path.write_text(text)

# 2) Main contracts/reconciliation page: voiding an empty contract
#    clears its hauling-job planning link in the same transaction.
path = Path('js/grain-contracts.js')
text = path.read_text()
marker = '''            voidedOpenBushels:
              numberValue(
                latest.openBushels
              ),

            updatedAt:
              serverTimestamp()'''
insert = '''            voidedOpenBushels:
              numberValue(
                latest.openBushels
              ),

            haulingJobId:
              null,

            haulingJobName:
              null,

            haulingJobLinkedAt:
              null,

            haulingJobLinkedByUid:
              null,

            haulingJobLinkedByName:
              null,

            haulingJobLinkedByEmail:
              null,

            updatedAt:
              serverTimestamp()'''
if marker not in text:
    raise SystemExit('Could not locate main contract void payload')
text = text.replace(marker, insert, 1)

local_marker = '''    contract.voided = true;
    contract.voidReason = reason;'''
local_insert = '''    contract.voided = true;
    contract.voidReason = reason;
    contract.haulingJobId = null;
    contract.haulingJobName = null;'''
if local_marker not in text:
    raise SystemExit('Could not locate main local void update')
text = text.replace(local_marker, local_insert, 1)
path.write_text(text)

# 3) Legacy contract list page: same void/unlink rule.
path = Path('js/grain-contract-list.js')
text = path.read_text()
marker = '''      voidedOpenBushels:
        numberValue(
          activeContract.openBushels
        ),

      updatedAt:
        serverTimestamp()'''
insert = '''      voidedOpenBushels:
        numberValue(
          activeContract.openBushels
        ),

      haulingJobId:
        null,

      haulingJobName:
        null,

      haulingJobLinkedAt:
        null,

      haulingJobLinkedByUid:
        null,

      haulingJobLinkedByName:
        null,

      haulingJobLinkedByEmail:
        null,

      updatedAt:
        serverTimestamp()'''
if marker not in text:
    raise SystemExit('Could not locate legacy contract void payload')
text = text.replace(marker, insert, 1)
path.write_text(text)

print('FarmVista contract hauling-job unlink patch applied.')
