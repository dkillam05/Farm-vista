// /js/grain-hauling-jobs.js
// FarmVista wrapper: preserve hauling-job implementation, add void-assignment guard,
// keep the Sold Under add action scoped only to the Sold Under combo,
// and propagate contract assignments back to linked hauling jobs.
import "/js/grain-hauling-jobs-core.js";
import "/js/grain-contracts-hauling-overview-groups.js?v=20260911-1540";
import "/js/grain-contracts-ui-followup.js?v=20260912-0624";
import "/js/grain-ticket-alert-table-sync.js?v=20260912-0624";
import "/js/grain-hauling-status-dnd.js?v=20260912-0715";
import "/js/grain-hauling-status-dnd-followup.js?v=20260912-0744";
import "/js/grain-hauling-ticket-sequence.js?v=20260912-0748";
import "/js/grain-hauling-auto-overflow.js?v=20260915-1131";
import "/js/grain-hauling-cross-entity-split-guard.js?v=20260915-1131";
import "/js/grain-hauling-split-portion-dnd.js?v=20260915-1131";
import "/js/grain-hauling-left-drop-zone.js?v=20260912-0915";
import "/js/grain-hauling-effective-totals.js?v=20260912-0928";
import "/js/grain-hauling-partial-checkboxes.js?v=20260912-0940";
import {
  ready,
  getFirestore,
  collection,
  getDocs,
  doc,
  updateDoc,
  serverTimestamp
} from "/js/firebase-init.js";

await ready;
const db = getFirestore();

const clean = value => String(value ?? "").trim();
const norm = value => clean(value).toLowerCase();

function ticketIsVoided(ticket) {
  return ticket?.voided === true || norm(ticket?.status).includes("void");
}

function contractIsVoided(contract) {
  return contract?.voided === true || norm(contract?.status || contract?.contractStatus).includes("void");
}

function installVoidGuardStyles() {
  if (document.getElementById("fv-hauling-void-guard-style")) return;
  const style = document.createElement("style");
  style.id = "fv-hauling-void-guard-style";
  style.textContent = `#void-hauling-job-btn:disabled,#void-hauling-job-btn.fv-void-disabled{background:rgba(179,38,30,.12)!important;color:rgba(157,36,30,.58)!important;border:1px solid rgba(179,38,30,.22)!important;box-shadow:none!important;cursor:not-allowed!important;opacity:1!important}`;
  document.head.appendChild(style);
}

function comboSelectFromButton(button) { return button?.closest?.(".fv-combo")?.querySelector?.("select") || null; }
function removeMisplacedSoldUnderRows() {
  const customerId="hauling-job-customer";
  Array.from(document.querySelectorAll(".fv-panel.show")).forEach(panel=>{
    const ownerId=clean(panel.dataset?.fvSelectId||panel.dataset?.selectId||panel.getAttribute?.("data-for"));
    if(ownerId===customerId)return;
    panel.querySelectorAll(".fv-item").forEach(item=>{if(clean(item.textContent)==="+ Add New Sold Under")item.remove();});
  });
}
function installSoldUnderComboScopeGuard(){
  let activeHaulingSelectId="";
  document.addEventListener("click",event=>{const button=event.target.closest?.(".fv-buttonish");const select=comboSelectFromButton(button);if(!select?.id?.startsWith("hauling-job-"))return;activeHaulingSelectId=select.id;if(activeHaulingSelectId!=="hauling-job-customer"){queueMicrotask(removeMisplacedSoldUnderRows);setTimeout(removeMisplacedSoldUnderRows,0);setTimeout(removeMisplacedSoldUnderRows,50);}},true);
  new MutationObserver(()=>{if(activeHaulingSelectId&&activeHaulingSelectId!=="hauling-job-customer")removeMisplacedSoldUnderRows();}).observe(document.body,{childList:true,subtree:true});
}

let contractJobSyncTimer=null,contractJobSyncRunning=false,contractJobSyncQueued=false;
function ticketContractIds(ticket){const ids=[];if(Array.isArray(ticket?.contractAllocations))ticket.contractAllocations.forEach(a=>{const id=clean(a?.contractId),bu=Number(a?.bushels||0);if(id&&Number.isFinite(bu)&&bu>0)ids.push(id)});const legacy=clean(ticket.contractId);if(!ids.length&&legacy)ids.push(legacy);return[...new Set(ids)]}
async function syncContractAssignedTicketsToHaulingJobs(){
 if(contractJobSyncRunning){contractJobSyncQueued=true;return}contractJobSyncRunning=true;
 try{const[contractSnap,ticketSnap]=await Promise.all([getDocs(collection(db,"grain_contracts")),getDocs(collection(db,"grain_tickets"))]);const map=new Map();contractSnap.docs.forEach(s=>{const c=s.data();if(contractIsVoided(c))return;const id=clean(c?.haulingJobId);if(id)map.set(s.id,id)});const repairs=[];ticketSnap.docs.forEach(s=>{const t=s.data();if(ticketIsVoided(t))return;const linked=[...new Set(ticketContractIds(t).map(id=>map.get(id)).filter(Boolean))];if(linked.length!==1)return;const jobId=linked[0],current=clean(t?.haulingJobId),manual=clean(t?.haulingJobManualUnassignedFromJobId);if(!current&&manual===jobId)return;if(current&&current!==jobId)return;if(current===jobId)return;repairs.push(updateDoc(doc(db,"grain_tickets",s.id),{haulingJobId:jobId,haulingJobAssignmentSource:"contract_link",haulingJobAssignedAt:serverTimestamp(),haulingJobManualUnassignedFromJobId:null,haulingJobManualUnassignedAt:null,haulingJobManualUnassignedByUid:null,haulingJobManualUnassignedByName:null,updatedAt:serverTimestamp()}))});if(repairs.length)await Promise.all(repairs)}catch(error){console.warn("[Hauling Jobs] Contract-to-job ticket propagation failed:",error)}finally{contractJobSyncRunning=false;if(contractJobSyncQueued){contractJobSyncQueued=false;setTimeout(syncContractAssignedTicketsToHaulingJobs,250)}}
}
function scheduleContractJobSync(delay=450){clearTimeout(contractJobSyncTimer);contractJobSyncTimer=setTimeout(syncContractAssignedTicketsToHaulingJobs,delay)}
function installContractJobPropagation(){scheduleContractJobSync(250);document.addEventListener("drop",e=>{if(e.target.closest?.(".contract-drop-card"))scheduleContractJobSync(700)},true);document.addEventListener("click",e=>{if(e.target.closest?.(".assign-selected-btn, .assign-all-btn"))scheduleContractJobSync(700)},true)}
async function assignmentCounts(jobId){const[c,t]=await Promise.all([getDocs(collection(db,"grain_contracts")),getDocs(collection(db,"grain_tickets"))]);return{contracts:c.docs.filter(s=>!contractIsVoided(s.data())&&clean(s.data()?.haulingJobId)===jobId).length,tickets:t.docs.filter(s=>!ticketIsVoided(s.data())&&clean(s.data()?.haulingJobId)===jobId).length}}
function disabledReason({contracts,tickets}){if(contracts&&tickets)return`${contracts} linked contract(s) and ${tickets} assigned ticket(s) must be unlinked first.`;if(contracts)return`${contracts} linked contract(s) must be unlinked first.`;if(tickets)return`${tickets} assigned ticket(s) must be unlinked first.`;return""}
async function syncVoidButton(){const button=document.getElementById("void-hauling-job-btn"),editId=clean(document.getElementById("hauling-job-edit-id")?.value);if(!button||button.hidden||!editId)return;button.disabled=true;try{const counts=await assignmentCounts(editId),reason=disabledReason(counts);if(clean(document.getElementById("hauling-job-edit-id")?.value)!==editId)return;button.dataset.fvBlockReason=reason;button.disabled=!!reason;button.classList.toggle("fv-void-disabled",!!reason);button.title=reason?`Cannot void this hauling job: ${reason}`:"Void this hauling job"}catch(e){button.disabled=true}}
function installHaulingModalTouchRepair(){/* preserved by core page styles; wrapper guard intentionally lightweight */}

installVoidGuardStyles();installSoldUnderComboScopeGuard();installContractJobPropagation();
document.addEventListener("click",e=>{if(e.target.closest?.("#edit-hauling-job-btn,[data-edit-hauling-job]"))setTimeout(syncVoidButton,150)},true);
