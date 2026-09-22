import assert from 'node:assert/strict';
import {grainSummary,effectiveTotals,farmToday} from '../js/dashboard/grain-summary.js';
const jobs=[
 {id:'a',crop:'Corn',startingBushels:1000},
 {id:'b',crop:'Soybeans',startingBushels:500},
 {id:'up',crop:'Corn',startingBushels:200,deliveryStartDate:'2026-10-01'},
 {id:'late',crop:'Corn',startingBushels:100,deliveryEndDate:'2026-09-01'},
 {id:'spot',crop:'Corn',startingBushels:0},
 {id:'oldspot',startingBushels:0,deliveryEndDate:'2026-09-01'},
 {id:'closed',startingBushels:999,manualClosed:true}
];
const tickets=[
 {haulingJobId:'a',netBu:900,haulingJobSplitAllocations:[{haulingJobId:'b',bushels:200},{allocationType:'unassigned',bushels:100},{allocationType:'spot',haulingJobId:'a',bushels:50}]},
 {haulingJobId:'a',netBu:100,voided:true},
 {haulingJobId:'a',netBu:50,haulingJobSplitAllocations:[{haulingJobId:'a',bushels:50}]}
];
assert.deepEqual([...effectiveTotals(tickets)], [['a',650],['b',200]]);
let result=grainSummary(jobs,tickets,'2026-09-22');
assert.deepEqual(result.totals,{Corn:650,Soybeans:300});
assert.deepEqual(result.rows.map(r=>r.id),['b','a','spot','late','up']);
assert.equal(farmToday(new Date('2026-09-23T02:00:00Z')),'2026-09-22');
assert.equal(grainSummary([{id:'x',startingBushels:100}], [{haulingJobId:'x',netBu:120}],'2026-09-22').rows.length,0);
assert.deepEqual(grainSummary([],[]).totals,{Corn:0,Soybeans:0});
assert.equal(effectiveTotals([{haulingJobId:'x',netBu:'1,234.56'}]).get('x'),1234.56);
console.log('PASS: split ownership, voids, spot loads, completion, overdue/upcoming, sorting, empty data, farm date');
