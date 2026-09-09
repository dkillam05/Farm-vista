from pathlib import Path

p = Path('js/grain-contracts.js')
s = p.read_text()

start = s.index('function getBuyersWithActiveContracts() {')
end = s.index('\n\nfunction getCustomersForBuyer(', start)
new = r'''function reconciliationBuyerKey(
  id,
  name
) {
  const cleanId = clean(id);
  if (cleanId) {
    return cleanId;
  }

  const cleanName = normalized(name);
  return cleanName
    ? `__ticket_buyer_name__:${cleanName}`
    : "";
}


function getBuyersForReconciliation() {
  const candidates = new Map();

  const addBuyer = (id, name) => {
    const key = reconciliationBuyerKey(id, name);
    const label = clean(name);

    if (!key || !label) return;

    if (!candidates.has(key)) {
      candidates.set(key, {
        id:key,
        sourceId:clean(id) || null,
        name:label
      });
    }
  };

  state.contracts
    .filter(contract =>
      !contract.voided &&
      numberValue(contract.openBushels) > EPSILON
    )
    .forEach(contract =>
      addBuyer(contract.buyerId, contract.buyerName)
    );

  state.tickets
    .filter(ticket =>
      !ticket.voided &&
      getUnassignedBushels(ticket) > EPSILON
    )
    .forEach(ticket =>
      addBuyer(
        ticket.buyerId,
        ticket.buyerName ||
        ticket.deliveryLocationBuyerName ||
        ticket.ocrElevatorName
      )
    );

  state.buyers.forEach(buyer => {
    const canonicalId = clean(buyer.id);
    const canonicalName = normalized(buyer.name);

    for (const [key, candidate] of candidates) {
      if (
        (canonicalId && candidate.sourceId === canonicalId) ||
        (canonicalName && normalized(candidate.name) === canonicalName)
      ) {
        candidates.delete(key);
        candidates.set(canonicalId || key, {
          id:canonicalId || key,
          sourceId:canonicalId || null,
          name:clean(buyer.name) || candidate.name
        });
        break;
      }
    }
  });

  return [...candidates.values()].sort((a, b) =>
    clean(a.name).localeCompare(
      clean(b.name),
      undefined,
      { numeric:true, sensitivity:'base' }
    )
  );
}
'''
s = s[:start] + new + s[end:]

old = '  const buyers =\n    getBuyersWithActiveContracts();'
if old not in s:
    raise SystemExit('picker buyer source missing')
s = s.replace(old, '  const buyers =\n    getBuyersForReconciliation();', 1)

old = '''  const buyer =\n    allBuyers\n      ? null\n      : state.buyers.find(\n          item =>\n            clean(item.id) ===\n            clean(buyerId)\n        );'''
new = '''  const buyer =\n    allBuyers\n      ? null\n      : getBuyersForReconciliation().find(\n          item =>\n            clean(item.id) ===\n            clean(buyerId)\n        );'''
if old not in s:
    raise SystemExit('customer buyer lookup missing')
s = s.replace(old, new, 1)

old = '''      : state.buyers.find(\n          item =>\n            clean(item.id) ===\n            clean(\n              state.reconcileBuyerId\n            )\n        );'''
new = '''      : getBuyersForReconciliation().find(\n          item =>\n            clean(item.id) ===\n            clean(\n              state.reconcileBuyerId\n            )\n        );'''
if s.count(old) < 2:
    raise SystemExit('reconciliation buyer lookups missing')
s = s.replace(old, new, 2)

old = '''        clean(\n          ticket.buyerId\n        ) ===\n        clean(\n          buyer.id\n        )'''
new = '''        clean(\n          ticket.buyerId\n        ) ===\n        clean(\n          buyer.sourceId || buyer.id\n        )'''
if old not in s:
    raise SystemExit('ticket buyer ID match missing')
s = s.replace(old, new, 1)

old = '''              clean(\n                contract.buyerId\n              ) ===\n              clean(\n                buyer.id\n              )'''
new = '''              clean(\n                contract.buyerId\n              ) ===\n              clean(\n                buyer.sourceId || buyer.id\n              )'''
if old not in s:
    raise SystemExit('contract buyer ID match missing')
s = s.replace(old, new, 1)

marker = '''  const customerIds =\n    new Set(\n      contracts\n        .map(\n          contract =>\n            clean(\n              contract.customerId\n            )\n        )\n        .filter(Boolean)\n    );'''
replacement = '''  const ticketCustomers =\n    state.tickets.filter(\n      ticket => {\n        if (\n          ticket.voided ||\n          getUnassignedBushels(ticket) <= EPSILON\n        ) {\n          return false;\n        }\n\n        if (allBuyers) {\n          return true;\n        }\n\n        return (\n          (\n            clean(ticket.buyerId) &&\n            clean(ticket.buyerId) ===\n              clean(buyer.sourceId || buyer.id)\n          ) ||\n          (\n            normalized(ticket.buyerName) &&\n            normalized(ticket.buyerName) ===\n              normalized(buyer.name)\n          )\n        );\n      }\n    );\n\n  const customerIds =\n    new Set(\n      [\n        ...contracts.map(contract => clean(contract.customerId)),\n        ...ticketCustomers.map(ticket => clean(ticket.customerId))\n      ].filter(Boolean)\n    );'''
if marker not in s:
    raise SystemExit('customer ID source missing')
s = s.replace(marker, replacement, 1)

old = '''  const customerNames =\n    new Set(\n      contracts\n        .map(\n          contract =>\n            normalized(\n              contract.customerName\n            )\n        )\n        .filter(Boolean)\n    );'''
new = '''  const customerNames =\n    new Set(\n      [\n        ...contracts.map(contract => normalized(contract.customerName)),\n        ...ticketCustomers.map(ticket => normalized(ticket.customerName))\n      ].filter(Boolean)\n    );'''
if old not in s:
    raise SystemExit('customer name source missing')
s = s.replace(old, new, 1)

p.write_text(s)

html = Path('pages/grain/grain-contracts.html')
h = html.read_text()
old_src = '<script type="module" src="/js/grain-contracts.js"></script>'
new_src = '<script type="module" src="/js/grain-contracts.js?v=20260909-1"></script>'
if old_src in h:
    h = h.replace(old_src, new_src, 1)
elif new_src not in h:
    raise SystemExit('grain-contracts script source missing')
html.write_text(h)

version = Path('js/version.js')
v = version.read_text()
if 'number:  "09.09.06"' not in v:
    raise SystemExit('expected version 09.09.06 not found')
v = v.replace('number:  "09.09.06"', 'number:  "09.09.07"', 1)
version.write_text(v)
