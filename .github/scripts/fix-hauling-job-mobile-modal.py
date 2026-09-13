from pathlib import Path

path = Path('pages/grain/grain-contracts.html')
text = path.read_text(encoding='utf-8')

MARKER = 'FV_HAULING_JOB_MOBILE_VERTICAL_ONLY'
if MARKER in text:
    print('Hauling job mobile modal fix already present')
    raise SystemExit(0)

css = r'''

    /* FV_HAULING_JOB_MOBILE_VERTICAL_ONLY
       Keep the Add/Edit Hauling Job sheet centered on phones and prevent
       accidental horizontal panning. Desktop modal sizing is unchanged. */
    @media (max-width:699px){
      #hauling-job-modal{
        box-sizing:border-box;
        width:100vw;
        max-width:100vw;
        padding:
          max(8px, env(safe-area-inset-top, 0px))
          10px
          max(8px, env(safe-area-inset-bottom, 0px));
        overflow-y:auto;
        overflow-x:hidden;
        align-items:flex-start;
        justify-content:center;
        overscroll-behavior-x:none;
        touch-action:pan-y;
      }

      #hauling-job-modal .modal-card{
        box-sizing:border-box;
        width:100%;
        max-width:calc(100vw - 20px);
        min-width:0;
        min-height:auto;
        margin:0 auto;
        border-radius:14px;
        overflow-x:hidden;
      }

      #hauling-job-modal .modal-header,
      #hauling-job-modal .modal-body,
      #hauling-job-modal .modal-actions,
      #hauling-job-modal #hauling-job-form,
      #hauling-job-modal .edit-grid,
      #hauling-job-modal .field,
      #hauling-job-modal .hauling-modal-note{
        box-sizing:border-box;
        width:100%;
        max-width:100%;
        min-width:0;
      }

      #hauling-job-modal .hauling-modal-note{
        white-space:normal;
        overflow-wrap:anywhere;
        word-break:normal;
      }

      #hauling-job-modal input,
      #hauling-job-modal select,
      #hauling-job-modal textarea,
      #hauling-job-modal button{
        max-width:100%;
        min-width:0;
      }

      #hauling-job-modal input,
      #hauling-job-modal select,
      #hauling-job-modal textarea{
        width:100%;
      }
    }
'''

anchor = '</style>'
if anchor not in text:
    raise SystemExit('Expected </style> anchor not found')

text = text.replace(anchor, css + '\n  </style>', 1)
path.write_text(text, encoding='utf-8')
print('Locked hauling job modal to vertical-only mobile scrolling')
