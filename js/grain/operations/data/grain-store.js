// FarmVista Grain Operations — centralized Firestore store
// All Grain Operations screens consume this store instead of reading the same collections independently.
import { ready, getFirestore, collection, getDocs, doc, getDoc } from '/js/firebase/firebase-init.js';

export const COLLECTIONS = Object.freeze({
  haulingJobs:'grain_hauling_jobs',
  contracts:'grain_contracts',
  tickets:'grain_tickets',
  buyers:'grain_buyers',
  customers:'grain_customers',
  locations:'grain_delivery_locations'
});

const state = {
  loaded:false,
  loading:false,
  error:null,
  haulingJobs:[], contracts:[], tickets:[], buyers:[], customers:[], locations:[], alertSettings:null
};
const listeners = new Set();
let loadingPromise=null;

export const grainState = () => state;
export const subscribe = fn => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = () => listeners.forEach(fn => { try{ fn(state); }catch(err){ console.error('[Grain Operations] subscriber failed',err); } });

async function read(db,name){
  const snap = await getDocs(collection(db,name));
  return snap.docs.map(snapshot => ({id:snapshot.id,...snapshot.data()}));
}
async function readAlertSettings(db){const snap=await getDoc(doc(db,'settings','grainTicketAlerts'));return snap.exists()?(snap.data()||{}):null}

export async function loadGrainOperations({force=false}={}){
  if(loadingPromise) return loadingPromise;
  if(state.loaded && !force) return state;
  state.loading=true;
  state.error=null;
  emit();
  loadingPromise=(async()=>{try{
    await ready;
    const db = getFirestore();
    const [haulingJobs,contracts,tickets,buyers,customers,locations,alertSettings] = await Promise.all([
      read(db,COLLECTIONS.haulingJobs), read(db,COLLECTIONS.contracts), read(db,COLLECTIONS.tickets),
      read(db,COLLECTIONS.buyers), read(db,COLLECTIONS.customers), read(db,COLLECTIONS.locations),readAlertSettings(db)
    ]);
    Object.assign(state,{haulingJobs,contracts,tickets,buyers,customers,locations,alertSettings,loaded:true});
  }catch(error){
    state.error=error;
    console.error('[Grain Operations] central load failed',error);
  }finally{
    state.loading=false;
    loadingPromise=null;
    emit();
  }
  return state})();
  return loadingPromise;
}

export async function refreshGrainOperations(){
  return loadGrainOperations({force:true});
}
