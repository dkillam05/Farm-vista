// Optional, public educational content. No field/farm/user data is sent.
// Text is a short attributed excerpt, never an invented quotation.
const API = 'https://en.wikipedia.org/w/api.php';
const KEY = 'fv_ag_history_v1';
const DAY = 86400000;
function read(){ try{ return JSON.parse(localStorage.getItem(KEY)) || {}; }catch(_){ return {}; } }
function write(value){ try{ localStorage.setItem(KEY, JSON.stringify(value)); }catch(_){} }
async function query(params, signal){
  const url = new URL(API);
  url.search = new URLSearchParams({action:'query',format:'json',formatversion:'2',origin:'*',...params});
  const response = await fetch(url, {signal, credentials:'omit', referrerPolicy:'no-referrer', priority:'low'});
  if (!response.ok) throw new Error('History unavailable');
  const data = await response.json();
  if (data.error) throw new Error('History unavailable');
  return data.query || {};
}
export async function nextHistory(signal){
  const cache = read();
  cache.seen = Array.isArray(cache.seen) ? cache.seen.slice(-200) : [];
  cache.items = Array.isArray(cache.items) ? cache.items : [];
  let unseen = cache.items.filter(item => !cache.seen.includes(item.id) && Date.now() - item.saved < 7 * DAY);
  if (!unseen.length){
    if (!Array.isArray(cache.pages) || Date.now() - Number(cache.pagesAt || 0) > 7 * DAY){
      const result = await query({list:'categorymembers',cmtitle:'Category:History of agriculture',cmnamespace:'0',cmlimit:'500'}, signal);
      cache.pages = result.categorymembers || [];
      cache.pagesAt = Date.now();
    }
    // No immediate cycling through the same small fixed list.
    const candidates = cache.pages.filter(page => !cache.seen.includes(page.pageid));
    for (let i=candidates.length-1; i>0; i--){ const j=Math.floor(Math.random()*(i+1)); [candidates[i],candidates[j]]=[candidates[j],candidates[i]]; }
    const ids = candidates.slice(0,6).map(page => page.pageid);
    if (!ids.length) return null;
    const result = await query({prop:'extracts',pageids:ids.join('|'),exintro:'1',explaintext:'1',exsentences:'2',exlimit:'6'}, signal);
    unseen = (result.pages || []).filter(page => !page.missing && page.extract && page.extract.length >= 45 && page.extract.length <= 650)
      .map(page => ({id:page.pageid,title:page.title,text:page.extract,saved:Date.now()}));
    cache.items = unseen;
  }
  if (signal.aborted) return null;
  const item = unseen[0];
  if (!item){ write(cache); return null; }
  cache.seen = [...cache.seen, item.id].slice(-200);
  write(cache);
  return {...item, url:`https://en.wikipedia.org/?curid=${Number(item.id)}`};
}
