/* FarmVista grain ticket OCR grade normalizer
   Rev 2026-09-10a — Scoular-Waverly + Cahokia Grain authoritative templates

   Known elevator templates override ambiguous generic OCR association. This is
   intentionally conservative: a template must be positively identified before
   positional rules are used.
*/

const clean = value => String(value ?? '').replace(/\r/g, '').trim();

function numeric(value) {
  if (value === null || value === undefined || value === '') return null;
  let raw = value;
  if (typeof value === 'object') raw = value.value ?? value.normalizedValue ?? value.text ?? value.rawValue ?? null;
  const match = clean(raw).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const n = Number(match[0]);
  return Number.isFinite(n) ? n : null;
}

const SPECS = {
  testWeight:{labels:['TW','TEST WT','TEST WEIGHT'],min:20,max:80},
  moisture:{labels:['MO','MOIST','MOISTURE','VOISTURE'],min:0,max:40},
  damage:{labels:['DM','DAM','DAMAGE','DAMAGED','DAMAGED KERNELS','DAMAGED KERNELS (TOTAL)'],min:0,max:100},
  foreignMaterial:{labels:['FM','F.M.','FOREIGN MATERIAL','BROKEN CORN & FOREIGN MAT','BROKEN CORN AND FOREIGN MAT'],min:0,max:100},
  splits:{labels:['SP','SPLITS'],min:0,max:100}
};

function escapeRegex(value){return value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}
function inRange(field,value){const spec=SPECS[field];return Number.isFinite(value)&&value>=spec.min&&value<=spec.max;}

function rawCandidates(rawText,field){
  const text=clean(rawText); if(!text)return [];
  const spec=SPECS[field];
  const lines=text.split(/\n+/).map(x=>x.trim()).filter(Boolean);
  const out=[];
  const numericOnly=line=>{
    const m=clean(line).replace(/,/g,'').match(/^([0-9]{1,2}(?:\.[0-9]{1,2})?)$/);
    if(!m)return null; const value=Number(m[1]); return inRange(field,value)?value:null;
  };
  for(const label of spec.labels){
    const escaped=escapeRegex(label).replace(/\\ /g,'\\s+');
    const forward=new RegExp(`^${escaped}[ \\t]*[:#-]?[ \\t]*([0-9]{1,2}(?:\\.[0-9]{1,2})?)[ \\t]*$`,'i');
    const reverse=new RegExp(`^([0-9]{1,2}(?:\\.[0-9]{1,2})?)[ \\t]+${escaped}[ \\t]*[:#-]?[ \\t]*$`,'i');
    const only=new RegExp(`^${escaped}[ \\t]*[:#-]?[ \\t]*$`,'i');
    for(let i=0;i<lines.length;i++){
      const line=lines[i]; let m=line.match(forward);
      if(m){const value=Number(m[1]);if(inRange(field,value))out.push({value,label,evidence:line,index:i});continue;}
      m=line.match(reverse);
      if(m){const value=Number(m[1]);if(inRange(field,value))out.push({value,label,evidence:line,index:i});continue;}
      if(!only.test(line))continue;
      const prev=i>0?numericOnly(lines[i-1]):null;
      const next=i+1<lines.length?numericOnly(lines[i+1]):null;
      if(prev!==null)out.push({value:prev,label,evidence:`${lines[i-1]} | ${line}`,index:i});
      else if(next!==null)out.push({value:next,label,evidence:`${line} | ${lines[i+1]}`,index:i});
    }
  }
  const seen=new Set();
  return out.filter(item=>{const key=`${item.label}|${item.value}|${item.index}`;if(seen.has(key))return false;seen.add(key);return true;}).sort((a,b)=>a.index-b.index);
}

function structuredValue(result,field){
  const a=numeric(result?.fields?.[field]); if(inRange(field,a))return a;
  const b=numeric(result?.grainTicket?.[field]); return inRange(field,b)?b:null;
}

function elevatorFamily(result,rawText){
  const h=`${result?.grainTicket?.parserProfile||''} ${result?.grainTicket?.elevatorName||''} ${rawText}`.toLowerCase();
  if(/\bscoular\b/.test(h))return 'Scoular';
  if(/archer\s+daniels|\badm\b/.test(h))return 'ADM';
  if(/\bcahokia\s+grain\b|\bcahokia,?\s+il\b/.test(h))return 'Cahokia';
  if(/\bchs\b|lowder/.test(h))return 'CHS';
  if(/bartlett/.test(h))return 'Bartlett';
  return 'Generic';
}

function extractScoularCustomer(rawText){
  const text=clean(rawText); if(!text||!/\bscoular\b/i.test(text))return null;
  const lines=text.split(/\n+/).map(x=>x.trim()).filter(Boolean); let account=null,name=null;
  for(let i=0;i<lines.length;i++){
    const m=lines[i].match(/\bCustomer\s*ID\s*:\s*([A-Z0-9._-]+)/i); if(!m)continue; account=m[1].trim();
    for(let j=i+1;j<Math.min(lines.length,i+4);j++){
      const c=lines[j]; if(/^(?:Inbound\s+Ticket|Scoular-|Elevator\s+ID|Yellow\s+Corn|Corn|Soybeans?|Wheat)\b/i.test(c))break;
      if(/[A-Za-z]/.test(c)&&!/^Customer\s*ID\b/i.test(c)){name=c;break;}
    } break;
  }
  return account||name?{account,name}:null;
}

function flexibleNumber(valueText,field){
  const value=clean(valueText); if(!value)return null;
  let m=value.match(/(?:^|[^0-9])(\d{1,2})\s*[.,]\s*(\d{1,2})(?!\d)/);
  if(m){const n=Number(`${m[1]}.${m[2]}`);return inRange(field,n)?n:null;}
  m=value.match(/(?:^|[^0-9])(\d{1,2})\s+(\d)(?!\d)/);
  if(m){const n=Number(`${m[1]}.${m[2]}`);return inRange(field,n)?n:null;}
  return null;
}

function scoularGradeBlock(rawText){
  const text=clean(rawText); if(!text||!/\bscoular\b/i.test(text))return null;
  if(!(/scoular\s*[-–]?\s*waverly/i.test(text)||/elevator\s*id\s*:?\s*wave\b/i.test(text)||/15379\s+jasmine\s+road/i.test(text)))return null;
  const upper=text.toUpperCase(); let start=upper.indexOf('GRADE:'); if(start<0)start=upper.indexOf('GRADE '); if(start<0)start=upper.indexOf('TEST WEIGHT'); if(start<0)return null;
  let end=upper.indexOf('NET LBS',start); if(end<0)end=upper.indexOf('GROSS BUSHELS',start); if(end<0)end=Math.min(text.length,start+1800);
  const section=text.slice(start,end); const lines=section.split(/\n+/).map(x=>x.trim()).filter(Boolean);
  const patterns={testWeight:/\bTEST\s*(?:WEIGHT|WT)\b/i,moisture:/\b(?:MOISTURE|VOISTURE|MOIST\s*URE)\b/i,damage:/\b(?:DAMAGED?\s+KERNELS?(?:\s*\(TOTAL\))?|DAMAGE)\b/i,foreignMaterial:/\b(?:BROKEN\s+CORN\s*(?:&|AND)\s*FOREIGN\s+MAT(?:ERIAL)?|FOREIGN\s+MATERIAL)\b/i};
  if(!Object.values(patterns).every(p=>p.test(section)))return null;
  const sameRow=field=>{for(const line of lines){if(!patterns[field].test(line))continue;const n=flexibleNumber(line.replace(patterns[field],' '),field);if(n!==null)return n;}return null;};
  const rows={testWeight:sameRow('testWeight'),moisture:sameRow('moisture'),damage:sameRow('damage'),foreignMaterial:sameRow('foreignMaterial')};
  const sequence=[];
  for(const line of lines){if(/\b(?:NET|TARE)\s+L\.?BS\b/i.test(line))break;const stripped=line.replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g,' ');const re=/(?:^|[^0-9])(\d{1,2})\s*[.,]\s*(\d{1,2})(?!\d)/g;let m;while((m=re.exec(stripped)))sequence.push(Number(`${m[1]}.${m[2]}`));}
  const pos=sequence.length>=4?{testWeight:sequence[0],moisture:sequence[1],damage:sequence[2],foreignMaterial:sequence[3]}:{};
  const values={testWeight:rows.testWeight??pos.testWeight??null,moisture:rows.moisture??pos.moisture??null,damage:rows.damage??pos.damage??null,foreignMaterial:rows.foreignMaterial??pos.foreignMaterial??null};
  if(!Object.keys(values).every(k=>inRange(k,values[k])))return null;
  return {...values,evidence:section,source:'scoular_waverly_template_v3'};
}

function cahokiaGradeBlock(rawText){
  const text=clean(rawText); if(!text)return null;
  /* Positive identification: Cahokia Grain header/location plus the known scale-ticket labels. */
  if(!(/\bCahokia\s+Grain\b/i.test(text)&&/\bCahokia,?\s+IL\b/i.test(text)&&/\bScale\s+Ticket\b/i.test(text)))return null;
  if(!/\bINBOUND\b/i.test(text))return null;

  const lines=text.split(/\n+/).map(x=>x.trim()).filter(Boolean);
  const labelPatterns={
    moisture:/^MOISTURE\b/i,
    testWeight:/^TEST\s+WEIGHT\b/i,
    foreignMaterial:/^FOREIGN\s+MATERIAL\b/i,
    damage:/^DAMAGE\b/i
  };

  function valueAfterLabel(field){
    const pattern=labelPatterns[field];
    for(let i=0;i<lines.length;i++){
      if(!pattern.test(lines[i]))continue;
      const same=flexibleNumber(lines[i].replace(pattern,' '),field); if(same!==null)return same;
      /* Cahokia prints each value directly beneath its label. Skip OCR noise but
         never cross another grade label or the weight section. */
      for(let j=i+1;j<Math.min(lines.length,i+4);j++){
        if(Object.values(labelPatterns).some(p=>p.test(lines[j]))||/^(?:Comment2|Customer|Weight\/Bu|Gross\s*\(lbs\)|Tare\s*\(lbs\)|Net\s*\(lbs\))/i.test(lines[j]))break;
        const n=flexibleNumber(lines[j],field); if(n!==null)return n;
      }
    }
    return null;
  }

  const values={
    moisture:valueAfterLabel('moisture'),
    testWeight:valueAfterLabel('testWeight'),
    foreignMaterial:valueAfterLabel('foreignMaterial'),
    damage:valueAfterLabel('damage')
  };

  if(!inRange('moisture',values.moisture)||!inRange('testWeight',values.testWeight)||!inRange('foreignMaterial',values.foreignMaterial)||!inRange('damage',values.damage))return null;

  return {...values,evidence:lines.slice(0,80).join('\n'),source:'cahokia_grain_template_v1'};
}

function chooseField(result,rawText,field,family,template){
  const structured=structuredValue(result,field);
  if(template&&Object.prototype.hasOwnProperty.call(template,field)){
    const value=template[field];
    return {value,confidence:structured===value?'verified':'high',source:template.source,evidence:template.evidence,structuredValue:structured};
  }
  const raw=rawCandidates(rawText,field);
  if(raw.length){
    const unique=[...new Set(raw.map(x=>x.value))];
    if(unique.length===1){const value=unique[0];return {value,confidence:structured===value?'verified':'high',source:'raw_label_value',evidence:raw[0].evidence,structuredValue:structured};}
    return {value:structured,confidence:'review',source:'conflicting_raw_labels',evidence:raw.map(x=>x.evidence).join(' | '),structuredValue:structured};
  }
  return {value:structured,confidence:structured===null?'missing':'structured',source:structured===null?'missing':'structured_ocr',evidence:null,structuredValue:structured};
}

export function normalizeGrainTicketGrades(result){
  if(!result?.grainTicket)return result;
  const rawText=clean(result?.grainTicket?.rawText||result?.document?.text||'');
  const family=elevatorFamily(result,rawText);
  const template=family==='Cahokia'?cahokiaGradeBlock(rawText):family==='Scoular'?scoularGradeBlock(rawText):null;
  const scoularCustomer=family==='Scoular'?extractScoularCustomer(rawText):null;
  const fields=['testWeight','moisture','damage','foreignMaterial','splits']; const audit={},review=[];
  if(!result.fields||typeof result.fields!=='object')result.fields={};
  if(scoularCustomer){if(scoularCustomer.account){result.grainTicket.customerAccountText=scoularCustomer.account;result.fields.customerAccountText=scoularCustomer.account;}if(scoularCustomer.name){result.grainTicket.customerText=scoularCustomer.name;result.fields.customerText=scoularCustomer.name;}}
  for(const field of fields){
    const chosen=chooseField(result,rawText,field,family,template); audit[field]=chosen;
    if(chosen.value!==null&&chosen.value!==undefined){result.grainTicket[field]=chosen.value;if(['raw_label_value','scoular_waverly_template_v3','cahokia_grain_template_v1'].includes(chosen.source))result.fields[field]=chosen.value;}
    if(chosen.confidence==='review')review.push(`Conflicting OCR readings for ${field}.`);
  }
  result.grainTicket.gradeParser={version:'farmvista-grade-v7',elevatorFamily:family,template:template?.source||null,fields:audit,customer:scoularCustomer};
  result.gradeNormalization=result.grainTicket.gradeParser;
  if(review.length)result.reviewWarnings=[...(Array.isArray(result.reviewWarnings)?result.reviewWarnings:[]),...review];
  return result;
}
