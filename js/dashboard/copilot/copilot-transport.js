// Retry transport, not the question. All attempts carry the exact same receipt ID.
export async function recoverableChat({endpoint,payload,getToken,sameSession,onRecover=()=>{},fetchImpl=fetch,sleep=ms=>new Promise(r=>setTimeout(r,ms)),now=Date.now,maxMs=270000}){
  const started=now(),body=JSON.stringify(payload);
  while(now()-started<maxMs){
    if(!sameSession())throw new Error('Your farm or sign-in changed. Reload FarmVista before continuing.');
    const token=await getToken();
    if(!token)throw new Error('Please sign in again to read your farm records.');
    if(!sameSession())throw new Error('Your farm or sign-in changed. Reload FarmVista before continuing.');
    let res,data;
    try{
      res=await fetchImpl(endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body,signal:AbortSignal.timeout(Math.min(30000,maxMs-(now()-started)))});
      data=await res.json();
    }catch{
      onRecover('Connection interrupted. Recovering your answer…');
      await sleep(2000);continue;
    }
    if(!sameSession())throw new Error('Your farm or sign-in changed. Reload FarmVista before continuing.');
    if(res.status===202&&data?.pending===true){onRecover('Your question is still working. Waiting for the saved answer…');await sleep(2000);continue;}
    if(!res.ok||data?.ok===false)throw new Error(`API error ${res.status} — ${data?.error||data?.message||'The request could not complete.'}`);
    if(!data||typeof data!=='object'){onRecover('Recovering your answer…');await sleep(2000);continue;}
    return data;
  }
  throw new Error('The connection did not recover in time. Your question may still be finishing. Please reconnect before trying again.');
}
