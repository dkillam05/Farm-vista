// Bounded workers stop scheduling obsolete filter selections.
export async function forFields(fields, work, isCurrent = () => true, concurrency = 6){
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, fields.length) }, async () => {
    while (isCurrent() && next < fields.length){
      const field = fields[next++];
      await work(field);
    }
  }));
}

export function chooseLoadPlan(fields, sortMode, pageSize){
  const all = fields.slice();
  const limit = list => pageSize === -1 ? list : list.slice(0, pageSize);
  if (sortMode === 'name_az' || sortMode === 'name_za'){
    all.sort((a,b) => String(a.name).localeCompare(String(b.name), undefined, {numeric:true, sensitivity:'base'}) * (sortMode === 'name_za' ? -1 : 1));
    return { rank: null, candidates: limit(all) };
  }
  return { rank: sortMode.startsWith('rain_') ? 'rainfall' : 'readiness', candidates: all };
}
