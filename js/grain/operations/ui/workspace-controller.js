// FarmVista Grain Operations — centralized workspace controller
import { loadGrainOperations, grainState, subscribe } from '../data/grain-store.js';
import { buildWorkspaceModel } from './workspace-model.js';
import { installLandscapeLock } from './landscape-lock.js';

let started=false;
const listeners=new Set();
let model=buildWorkspaceModel(grainState());
function publish(state){model=buildWorkspaceModel(state);listeners.forEach(listener=>{try{listener(model,state)}catch(error){console.error('[Grain Operations] workspace listener failed',error)}})}
export const getWorkspaceModel=()=>model;
export const onWorkspaceChange=listener=>{listeners.add(listener);listener(model,grainState());return()=>listeners.delete(listener)};
export async function startGrainWorkspace(){if(started)return model;started=true;installLandscapeLock();subscribe(publish);const state=await loadGrainOperations();publish(state);return model;}
