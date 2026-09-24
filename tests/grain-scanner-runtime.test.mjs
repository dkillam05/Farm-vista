import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { planTicketAllocation } from '../js/grain/operations/tickets/ticket-allocation.js';
import { effectiveJobTotals } from '../js/grain/operations/core/grain-rules.js';

// Run the actual entry-page transformations: testing the core alone missed
// the loader deleting the ticket history required by the allocation planner.
const entry = await readFile(new URL('../pages/grain/grain-ticket-scan.html', import.meta.url), 'utf8');
const core = await readFile(new URL('../pages/grain/grain-ticket-scan-core.html', import.meta.url), 'utf8');
const generated = await new Promise((resolve, reject) => {
  const body = {};
  Object.defineProperty(body, 'innerHTML', { set: value => reject(new Error(value)) });
  vm.runInNewContext(entry.match(/<script>([\s\S]*)<\/script>/)[1], {
    fetch: async () => ({ ok: true, text: async () => core }),
    document: { open() {}, write: resolve, close() {}, body },
    console: { error: reject }
  });
});
const loadSource = generated.slice(generated.indexOf('async function loadFarmVistaData() {'), generated.indexOf('// OCR → FARMVISTA MATCHING'));
const identity = { buyerId: 'buyer', deliveryLocationId: 'location', customerId: 'customer', crop: 'Corn' };
const jobs = [
  { ...identity, id: 'old', startingBushels: 5000, deliveryStartDate: '2026-09-01', deliveryEndDate: '2026-09-30' },
  { ...identity, id: 'next', startingBushels: 3000, deliveryStartDate: '2026-09-23', deliveryEndDate: '2026-10-09' },
  { ...identity, id: 'last', startingBushels: 2500, deliveryStartDate: '2026-09-24', deliveryEndDate: '2026-10-16' }
];
const ticket = (id, bu) => ({ ...identity, id, ticketNumber: id, netBushels: bu, date: '2026-09-24' });
const records = { HAULING_JOB_COLLECTION: jobs, TICKET_COLLECTION: [{ ...ticket('earlier', 5000), haulingJobId: 'old' }] };
const context = vm.createContext({
  auth: { currentUser: { uid: 'test-user' } }, isGuestScan: false, db: {}, processingText: {},
  console: { log() {} }, collection: (_db, name) => name,
  getDocs: async name => ({ docs: (records[name] || []).map(row => ({ id: row.id, data: () => row })) }),
  snapshotToArray: snap => snap.docs.map(doc => ({ ...doc.data(), id: doc.id })),
  findSignedInEmployee: async () => null,
  ...Object.fromEntries(['BUYER_COLLECTION', 'CUSTOMER_COLLECTION', 'LOCATION_COLLECTION', 'CONTRACT_COLLECTION', 'HAULING_JOB_COLLECTION', 'TICKET_COLLECTION', 'EMPLOYEE_COLLECTION', 'ALIAS_COLLECTION', 'FIELD_COLLECTION', 'BIN_SITE_COLLECTION', 'GRAIN_BAG_COLLECTION'].map(key => [key, key]))
});
vm.runInContext(loadSource, context);
for (const [id, bu] of [['first', 1042.86], ['second', 997.61], ['third', 1002.86]]) {
  await context.loadFarmVistaData();
  const incoming = ticket(id, bu);
  const result = planTicketAllocation(incoming, { haulingJobs: context.haulingJobs, tickets: context.grainTickets }).hauling;
  assert.equal(result.haulingJobId, 'next', 'scanner must account for the already-filled older job');
  assert.equal(result.spotBushels, 0, 'remaining normal capacity must precede Spot');
  records.TICKET_COLLECTION.push({ ...incoming, haulingJobId: result.haulingJobId, haulingJobSplitAllocations: result.haulingJobSplitAllocations });
}
const totals = effectiveJobTotals(records.TICKET_COLLECTION);
assert.equal(totals.get('old'), 5000);
assert.equal(totals.get('next'), 3000);
assert.equal(totals.get('last'), 43.33);
context.getDocs = async name => { if (name === 'TICKET_COLLECTION') throw new Error('ticket history unavailable'); return { docs: [] }; };
await assert.rejects(context.loadFarmVistaData(), /ticket history unavailable/, 'failed history reads must stop allocation instead of treating jobs as empty');
console.log('PASS: transformed scanner loads ticket history, refreshes between scans, rolls over and splits, and stops on history failure');
