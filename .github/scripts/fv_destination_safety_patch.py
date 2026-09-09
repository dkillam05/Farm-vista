from pathlib import Path

# ---------------- Ticket Detail ----------------
p = Path('pages/grain/grain-ticket-detail.html')
s = p.read_text()

old = '''        if (\n          byId\n        ) {\n\n          return byId;\n\n        }'''
new = '''        if (\n          byId\n        ) {\n\n          const savedOcrCity =\n            compactNormalize(\n              state.ticket.ocrDeliveryCity ||\n              state.ticket.deliveryCity\n            );\n\n          const savedOcrState =\n            compactNormalize(\n              state.ticket.ocrDeliveryState ||\n              state.ticket.deliveryState\n            );\n\n          const savedOcrZip =\n            compactNormalize(\n              state.ticket.ocrDeliveryZip ||\n              state.ticket.deliveryZip\n            );\n\n          const savedLocationMatchesEvidence =\n            (\n              !savedOcrCity ||\n              compactNormalize(byId.city) ===\n                savedOcrCity\n            ) &&\n            (\n              !savedOcrState ||\n              compactNormalize(byId.state) ===\n                savedOcrState\n            ) &&\n            (\n              !savedOcrZip ||\n              compactNormalize(byId.zip) ===\n                savedOcrZip\n            );\n\n          if (\n            savedLocationMatchesEvidence\n          ) {\n\n            return byId;\n\n          }\n\n          console.warn(\n            \"[Grain Ticket Detail] Ignoring saved destination because OCR location evidence conflicts.\",\n            {\n              savedLocationId,\n              savedLocationName: byId.locationName,\n              savedLocationCity: byId.city,\n              savedLocationState: byId.state,\n              ocrCity: savedOcrCity,\n              ocrState: savedOcrState,\n              ocrZip: savedOcrZip\n            }\n          );\n\n        }'''
if old not in s:
    raise SystemExit('detail saved location block not found')
s = s.replace(old, new, 1)
p.write_text(s)

# ---------------- Scanner Core ----------------
p = Path('pages/grain/grain-ticket-scan-core.html')
s = p.read_text()

old = '''    if (\n      location\n    ) {\n\n      return {\n        matched:\n          true,\n\n        matchType:\n          \"learned_alias\",\n\n        location\n      };\n\n    }'''
new = '''    if (\n      location\n    ) {\n\n      const aliasHeaderCityState =\n        findCityStateInTicketHeader(\n          grainTicket\n        );\n\n      const aliasOcrCity =\n        normalizeMatchText(\n          aliasHeaderCityState.city ||\n          grainTicket?.deliveryCity ||\n          \"\"\n        );\n\n      const aliasOcrState =\n        normalizeMatchText(\n          aliasHeaderCityState.state ||\n          grainTicket?.deliveryState ||\n          \"\"\n        );\n\n      const aliasOcrZip =\n        normalizeZipForMatch(\n          aliasHeaderCityState.zip ||\n          grainTicket?.deliveryZip\n        );\n\n      const aliasLocationCity =\n        normalizeMatchText(\n          getLocationCity(location)\n        );\n\n      const aliasLocationState =\n        normalizeMatchText(\n          getLocationState(location)\n        );\n\n      const aliasLocationZip =\n        normalizeZipForMatch(\n          getLocationZip(location)\n        );\n\n      const aliasContradictsLocation =\n        (\n          aliasOcrCity &&\n          aliasLocationCity &&\n          aliasOcrCity !== aliasLocationCity\n        ) ||\n        (\n          aliasOcrState &&\n          aliasLocationState &&\n          aliasOcrState !== aliasLocationState\n        ) ||\n        (\n          aliasOcrZip &&\n          aliasLocationZip &&\n          aliasOcrZip !== aliasLocationZip\n        );\n\n      if (\n        !aliasContradictsLocation\n      ) {\n\n        return {\n          matched:\n            true,\n\n          matchType:\n            \"learned_alias\",\n\n          location\n        };\n\n      }\n\n      console.warn(\n        \"[Grain Ticket] Rejected learned destination alias because the ticket location conflicts.\",\n        {\n          learnedLocationId: location.id,\n          learnedLocationName: getLocationName(location),\n          learnedLocationCity: getLocationCity(location),\n          ticketCity: aliasOcrCity,\n          ticketState: aliasOcrState,\n          ticketZip: aliasOcrZip\n        }\n      );\n\n    }'''
if old not in s:
    raise SystemExit('scanner learned location alias block not found')
s = s.replace(old, new, 1)

marker = '''          const locationZip =\n            normalizeZipForMatch(\n              getLocationZip(\n                location\n              )\n            );\n\n\n          const locationName ='''
replacement = '''          const locationZip =\n            normalizeZipForMatch(\n              getLocationZip(\n                location\n              )\n            );\n\n\n          /*\n            Hard safety rule: strong physical location evidence is allowed\n            to DISQUALIFY a destination. A buyer-family/company name such as\n            CHS must never overcome a conflicting city/state/ZIP.\n          */\n          const physicalLocationConflict =\n            (\n              ocrCity &&\n              locationCity &&\n              ocrCity !== locationCity\n            ) ||\n            (\n              ocrState &&\n              locationState &&\n              ocrState !== locationState\n            ) ||\n            (\n              ocrZip &&\n              locationZip &&\n              ocrZip !== locationZip\n            );\n\n\n          if (\n            physicalLocationConflict\n          ) {\n\n            return {\n              location,\n              score: 0,\n              reasons: [\n                \"physical_location_conflict\"\n              ]\n            };\n\n          }\n\n\n          const locationName ='''
if marker not in s:
    raise SystemExit('scanner location scoring insertion point not found')
s = s.replace(marker, replacement, 1)
p.write_text(s)

# ---------------- Scanner cache key ----------------
p = Path('pages/grain/grain-ticket-scan.html')
s = p.read_text()
old = "const CORE_URL = '/pages/grain/grain-ticket-scan-core.html?v=20260909-1';"
new = "const CORE_URL = '/pages/grain/grain-ticket-scan-core.html?v=20260909-2';"
if old not in s:
    raise SystemExit('scanner core cache key not found')
p.write_text(s.replace(old, new, 1))

# ---------------- Version ----------------
p = Path('js/version.js')
s = p.read_text()
if 'number:  "09.09.02"' not in s:
    raise SystemExit('expected version 09.09.02 not found')
s = s.replace('number:  "09.09.02"', 'number:  "09.09.03"', 1)
s = s.replace('date:    "2026-09-08"', 'date:    "2026-09-09"', 1)
p.write_text(s)
