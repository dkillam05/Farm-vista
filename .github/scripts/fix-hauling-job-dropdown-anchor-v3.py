from pathlib import Path

path = Path('pages/grain/grain-contracts.html')
text = path.read_text(encoding='utf-8')

marker = 'FV_HAULING_JOB_DROPDOWN_ANCHOR_V3'
if marker in text:
    print('Hauling job dropdown anchor v3 already present')
    raise SystemExit(0)

anchor = '''    /* FV hauling job touch-lock v2
       Keep Add/Edit Hauling Job centered on touch devices and prevent
       Safari from horizontally panning the modal sheet. */
'''

if anchor not in text:
    raise SystemExit('Expected hauling job touch-lock v2 CSS was not found')

insert_before = '\n  </style>\n</head>\n'
if insert_before not in text:
    raise SystemExit('Expected closing style/head anchor was not found')

css = r'''

    /* FV_HAULING_JOB_DROPDOWN_ANCHOR_V3
       Keep the modal backdrop fixed. Scroll the card itself so custom
       select menus continue to calculate their viewport position from
       the field that opened them instead of jumping to the top of Safari. */
    @media (max-width: 900px), (pointer: coarse) {
      #hauling-job-modal {
        overflow: hidden !important;
        touch-action: none !important;
      }

      #hauling-job-modal .modal-card {
        max-height: calc(
          100dvh -
          max(10px, env(safe-area-inset-top)) -
          max(10px, env(safe-area-inset-bottom)) -
          20px
        ) !important;
        overflow-x: hidden !important;
        overflow-y: auto !important;
        overscroll-behavior-x: none !important;
        overscroll-behavior-y: contain;
        touch-action: pan-y !important;
        -webkit-overflow-scrolling: touch;
      }

      #hauling-job-modal .modal-body,
      #hauling-job-modal #hauling-job-form,
      #hauling-job-modal .edit-grid,
      #hauling-job-modal .field {
        position: relative;
      }
    }
'''

text = text.replace(insert_before, css + insert_before, 1)
path.write_text(text, encoding='utf-8')
print('Patched hauling job dropdown anchoring while preserving vertical-only scrolling')
