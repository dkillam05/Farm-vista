// FarmVista Grain Operations — deterministic business-rule scenario checks.
// These do not touch Firestore and can be run from the central test harness/console.
import { buildAutomaticHaulingAssignment } from '../hauling/hauling-allocation.js';
import { planManualHaulingMove,planContractMove } from '../drag-drop/allocation-controller.js';
import { round2 } from './grain-rules.js';
const approx=(a,b)=>Math.abs(Number(a)-Number(b))<0.01;
export function runGrainScenarios(){
  const results=[];
  const old={id:'old',buyerId:'scoular',deliveryLocationId:'waverly',customerId:'dowson',crop:'Corn',startingBushels:5000,deliveryStartDate:'2026-09-01',active:true,status:'active'};
  const next={id:'next',buyerId:'scoular',deliveryLocationId:'waverly',customerId:'dowson',crop:'Corn',startingBushels:2500,deliveryStartDate:'2026-09-16',active:true,status:'active'};
  const previous=[997.26,968.57,1005.36,976.07,983.93].map((netBu,i)=>({id:`p${i}`,buyerId:'scoular',deliveryLocationId:'waverly',customerId:'dowson',crop:'Corn',haulingJobId:'old',netBu}));
  const ticket={id:'450726',buyerId:'scoular',deliveryLocationId:'waverly',customerId:'dowson',crop:'Corn',date:'2026-09-16',netBu:984.64};
  const result=buildAutomaticHaulingAssignment(ticket,{haulingJobs:[old,next],tickets:previous});
  const split=result.haulingJobSplitAllocations.find(x=>x.haulingJobId==='next');
  const expectedOld=round2(5000-previous.reduce((s,x)=>s+x.netBu,0)),expectedNext=round2(ticket.netBu-expectedOld);
  results.push({name:'Scoular 5000 to 2500 rollover',pass:result.sourceJobId==='old'&&approx(result.sourceBushels,expectedOld)&&approx(split?.bushels,expectedNext)&&approx(result.spotBushels,0),expected:{old:expectedOld,next:expectedNext,spot:0},actual:{old:result.sourceBushels,next:split?.bushels||0,spot:result.spotBushels}});

  const partialTicket={...ticket,id:'partial-hauling',haulingJobId:'old',netBu:1000,haulingJobSplitAllocations:[{sourceJobId:'old',haulingJobId:'next',bushels:200,allocationType:'job'}]};
  const nearlyFullNext={...next,startingBushels:1000};
  const otherNext={id:'other-next',haulingJobId:'next',netBu:700,crop:'Corn',buyerId:'scoular',deliveryLocationId:'waverly',customerId:'dowson'};
  const manual=planManualHaulingMove(partialTicket,nearlyFullNext,{bushels:500,state:{tickets:[partialTicket,otherNext]}});
  results.push({name:'Repeated hauling partial move cannot overfill target',pass:manual.ok&&approx(manual.changes?.bushels,100),expected:{additional:100},actual:{additional:manual.changes?.bushels||0}});

  const contract={id:'contract-a',buyerId:'scoular',deliveryLocationId:'waverly',customerId:'dowson',crop:'Corn',bushels:1000,deliveryStartDate:'2026-09-01',deliveryEndDate:'2026-09-30'};
  const contractTicket={...ticket,id:'partial-contract',netBu:1000,contractAllocations:[{contractId:'contract-a',contractNumber:'A',bushels:200}]};
  const otherContractTicket={...ticket,id:'other-contract',netBu:700,contractId:'contract-a',contractNumber:'A'};
  const contractMove=planContractMove(contractTicket,contract,{bushels:500,state:{tickets:[contractTicket,otherContractTicket]}});
  results.push({name:'Repeated contract partial move cannot overfill target',pass:contractMove.ok&&approx(contractMove.changes?.bushels,100),expected:{additional:100},actual:{additional:contractMove.changes?.bushels||0}});

  const sameSource=planManualHaulingMove(partialTicket,old,{bushels:100,state:{tickets:[partialTicket]}});
  results.push({name:'Ticket cannot be dragged back onto its source hauling job',pass:sameSource.ok===false,expected:{ok:false},actual:{ok:sameSource.ok,reason:sameSource.reason}});
  return results;
}
