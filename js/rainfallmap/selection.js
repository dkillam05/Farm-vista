export function getSelectedFarmId(){
  try{
    const qp = new URLSearchParams(window.location.search);
    const qv = String(qp.get('farmId') || '').trim();
    if (qv) return qv;
  }catch(_){}

  const lsKeys = [
    'fv_selected_farm_id',
    'fvFarmId',
    'selectedFarmId',
    'currentFarmId',
    'farmId'
  ];

  for (const key of lsKeys){
    try{
      const v = String(localStorage.getItem(key) || '').trim();
      if (v) return v;
    }catch(_){}
  }

  const globals = [
    window.FV_CURRENT_FARM_ID,
    window.currentFarmId,
    window.selectedFarmId,
    window.FV_CONTEXT && window.FV_CONTEXT.farmId,
    window.FV_CONTEXT && window.FV_CONTEXT.selectedFarmId
  ];

  for (const v of globals){
    const s = String(v || '').trim();
    if (s) return s;
  }

  return '';
}
