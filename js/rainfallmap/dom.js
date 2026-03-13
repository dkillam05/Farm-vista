export function $(id){
  return document.getElementById(id);
}

export function setStatus(msg){
  const el = $('statusText');
  if (el) el.textContent = String(msg || '');
}

export function setFieldsMeta(n){
  const el = $('fieldsText');
  if (el) el.textContent = String(Number(n || 0));
}

export function setPointMeta(n){
  const el = $('pointsText');
  if (el) el.textContent = String(Number(n || 0));
}

export function setDebug(msg){
  const el = $('debugText');
  if (el) el.textContent = String(msg || '');
}

export function setModeText(msg){
  const el = $('modeText');
  if (el) el.textContent = String(msg || '');
}

export function setModeChip(msg){
  const el = $('mapModeChip');
  if (el) el.textContent = String(msg || '');
}
