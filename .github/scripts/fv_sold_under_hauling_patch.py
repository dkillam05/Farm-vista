from pathlib import Path

p = Path('pages/grain/grain-ticket-scan.html')
s = p.read_text()

old = '''          items:\n            eligibleCustomers.map(\n              item => ({\n                label: getCustomerName(item),\n                searchText: getCustomerName(item),\n                value: item\n              })\n            ),\n          allowSkip: true,\n          allowBack: true\n        });'''
new = '''          items: [\n            ...eligibleCustomers.map(\n              item => ({\n                label: getCustomerName(item),\n                searchText: getCustomerName(item),\n                value: item\n              })\n            ),\n            {\n              label: "Unknown / I'm not sure",\n              searchText: "unknown not sure don't know",\n              value: "__unknown_sold_under__"\n            }\n          ],\n          allowSkip: true,\n          allowBack: true\n        });'''
assert old in s, 'Sold Under picker block not found'
s = s.replace(old, new, 1)

old = '''      else if (selectedCustomer) {\n        customer = selectedCustomer;\n\n        const originalEvidence =\n          String(\n            grainTicket.customerText ||\n            ""\n          ).trim();'''
new = '''      else if (\n        selectedCustomer === "__unknown_sold_under__"\n      ) {\n        customer = null;\n        skippedReasons.push("sold_under_unknown");\n\n        ocrResult.manualCorrections = {\n          ...(ocrResult.manualCorrections || {}),\n          customer: {\n            originalValue:\n              String(grainTicket.customerText || "").trim() || null,\n            selectedId: null,\n            selectedValue: "Unknown",\n            source: "driver_unknown",\n            learningEligible: false,\n            learningReason: "driver_could_not_identify_sold_under"\n          }\n        };\n      }\n      else if (selectedCustomer) {\n        customer = selectedCustomer;\n\n        const originalEvidence =\n          String(\n            grainTicket.customerText ||\n            ""\n          ).trim();'''
assert old in s, 'Sold Under selected-customer handler not found'
s = s.replace(old, new, 1)

old = '''      else {\n        skippedReasons.push("customer_not_selected");\n      }\n    }\n  }\n\n  /* ========================================================\n     HAULING JOB — NARROWED BY SOLD UNDER WHEN KNOWN\n  ======================================================== */'''
new = '''      else {\n        skippedReasons.push("sold_under_driver_skipped");\n      }\n    }\n  }\n\n  /* ========================================================\n     HAULING JOB — NARROWED BY SOLD UNDER WHEN KNOWN\n  ======================================================== */'''
assert old in s, 'Sold Under skip handler not found'
s = s.replace(old, new, 1)

p.write_text(s)
