from pathlib import Path

path = Path('pages/grain/grain-contracts.html')
text = path.read_text(encoding='utf-8')

MARKER = 'FV hauling job touch-lock v2'
if MARKER in text:
    print('Touch-lock patch already present')
    raise SystemExit(0)

anchor = '''  </style>\n'''

css = r'''
    /* FV hauling job touch-lock v2
       Keep Add/Edit Hauling Job centered on touch devices and prevent
       Safari from horizontally panning the modal sheet. */
    @media (max-width: 900px), (pointer: coarse) {
      #hauling-job-modal {
        position: fixed !important;
        top: 0 !important;
        right: auto !important;
        bottom: 0 !important;
        left: 0 !important;
        width: 100dvw !important;
        max-width: 100dvw !important;
        height: 100dvh !important;
        max-height: 100dvh !important;
        padding: max(10px, env(safe-area-inset-top)) 10px max(10px, env(safe-area-inset-bottom)) !important;
        margin: 0 !important;
        overflow-x: hidden !important;
        overflow-y: auto !important;
        overscroll-behavior-x: none;
        touch-action: pan-y;
        justify-content: center !important;
        align-items: flex-start !important;
      }

      #hauling-job-modal .modal-card {
        width: min(100%, 900px) !important;
        max-width: 100% !important;
        min-width: 0 !important;
        min-height: 0 !important;
        height: auto !important;
        margin: 0 auto !important;
        overflow-x: hidden !important;
        border-radius: 14px !important;
      }

      #hauling-job-modal .modal-header,
      #hauling-job-modal .modal-body,
      #hauling-job-modal .modal-actions,
      #hauling-job-modal form,
      #hauling-job-modal .edit-grid,
      #hauling-job-modal .field,
      #hauling-job-modal .hauling-modal-note {
        width: 100% !important;
        max-width: 100% !important;
        min-width: 0 !important;
        box-sizing: border-box !important;
      }

      #hauling-job-modal .hauling-modal-note,
      #hauling-job-modal .modal-sub,
      #hauling-job-modal label {
        overflow-wrap: anywhere;
        word-break: normal;
        white-space: normal;
      }

      #hauling-job-modal input,
      #hauling-job-modal select,
      #hauling-job-modal textarea,
      #hauling-job-modal button {
        max-width: 100% !important;
        min-width: 0 !important;
        box-sizing: border-box !important;
      }
    }
'''

if anchor not in text:
    raise SystemExit('Could not find closing style tag')

text = text.replace(anchor, css + '\n' + anchor, 1)
path.write_text(text, encoding='utf-8')
print('Applied hauling-job touch modal lock')
