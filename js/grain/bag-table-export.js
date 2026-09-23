/* Letter-size export of the currently rendered bag or bin inventory groups. */
(() => {
  'use strict';
  const isBins=!!document.getElementById('binShare');
  const prefix=isBins?'bin':'bag';
  const title=isBins?'Grain Bin Inventory':'Grain Bag Inventory';
  const widths=isBins?[260,140,168]:[135,54,70,77,58,53,57,64];
  const clean = value => String(value || '').replace(/[▾▸]/g,'').replace(/•/g,' | ').replace(/[–—]/g,'-').replace(/\s+/g,' ').trim();
  const escape = value => String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function snapshot(table){
    const copy=table.cloneNode(true);
    copy.querySelectorAll('.field-edit,.chevron').forEach(el=>el.remove());
    return {
      head:[...copy.querySelectorAll('thead th')].map(cell=>clean(cell.textContent)),
      rows:[...copy.querySelectorAll('tbody tr')].map(row=>({
        group:row.classList.contains('site-group-row') || row.classList.contains('farm-group-row') || row.classList.contains('crop-group-row'),
        total:row.classList.contains('bag-total-row') || row.classList.contains('bin-total-row'),
        cells:[...row.cells].map(cell=>({content:clean(cell.textContent),colSpan:cell.colSpan}))
      })),
      season:clean(document.getElementById(isBins?'inventoryTotal':'seasonPill')?.textContent),
      date:new Date().toLocaleString('en-US',{timeZone:'America/Chicago'})+' CT'
    };
  }
  function pdf(data){
    const doc=new window.jspdf.jsPDF({unit:'pt',format:'letter',orientation:'portrait'});
    doc.setProperties({title,subject:data.season,creator:'FarmVista'});
    doc.setFontSize(17);doc.text('FarmVista - '+title,22,34);
    doc.setFontSize(9);doc.text(data.season,22,51);doc.text('Prepared '+data.date,22,65);
    doc.autoTable({startY:78,margin:{left:22,right:22,top:28,bottom:30},tableWidth:568,
      head:[data.head],body:data.rows.map(row=>row.cells),theme:'grid',
      styles:{font:'helvetica',fontSize:8,cellPadding:5,overflow:'linebreak',lineColor:[205,213,206],lineWidth:.4,textColor:[25,36,28]},
      headStyles:{fillColor:[40,73,47],textColor:255,fontStyle:'bold'},
      columnStyles:Object.fromEntries(widths.map((cellWidth,i)=>[i,{cellWidth}])),
      rowPageBreak:'avoid',showHead:'everyPage',
      didParseCell:hook=>{
        if(hook.section!=='body')return;
        const row=data.rows[hook.row.index];
        if(row.group || row.total){hook.cell.styles.fillColor=row.group?[225,234,224]:[241,245,237];hook.cell.styles.fontStyle='bold';}
      }
    });
    const pages=doc.getNumberOfPages();
    for(let page=1;page<=pages;page++){doc.setPage(page);doc.setFontSize(8);doc.setTextColor(95);doc.text(`FarmVista | ${page} of ${pages}`,590,775,{align:'right'});}
    return doc;
  }
  function print(data){
    const popup=window.open('','_blank');
    if(!popup)throw new Error('Allow pop-ups to open the print view.');
    popup.opener=null;
    const rows=data.rows.map(row=>`<tr class="${row.group?'group':row.total?'total':''}">${row.cells.map(cell=>`<td colspan="${cell.colSpan}">${escape(cell.content)}</td>`).join('')}</tr>`).join('');
    popup.document.write(`<!doctype html><html><head><title>${escape(title)}</title><style>
      @page{size:letter portrait;margin:.3in}*{box-sizing:border-box}body{font:9pt Arial;color:#19241c;margin:0;background:white}h1{font-size:17pt;margin:0 0 8pt}p{margin:4pt 0}table{width:100%;border-collapse:collapse;table-layout:fixed;margin-top:12pt}th,td{border:.5pt solid #cdd5ce;padding:5pt;overflow-wrap:anywhere}th{background:#e1eae0;text-align:left}tr{break-inside:avoid}.group,.total{background:#f1f5ed;font-weight:bold}thead{display:table-header-group}button{margin:12px 0;padding:10px 22px}@media print{button{display:none}}
      </style></head><body><button onclick="window.print()">Print</button><h1>FarmVista - ${escape(title)}</h1><p>${escape(data.season)}</p><p>Prepared ${escape(data.date)}</p><table><colgroup>${widths.map(width=>`<col style="width:${width/568*100}%">`).join('')}</colgroup><thead><tr>${data.head.map(text=>`<th>${escape(text)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></body></html>`);
    popup.document.close();popup.focus();popup.print();
  }
  window[isBins?'FVBinTableExport':'FVBagTableExport']={snapshot,pdf,print};
  const button=document.getElementById(prefix+'Share'),dialog=document.getElementById(prefix+'ShareDialog');
  let data,file;
  button.addEventListener('click',()=>{
    const status=document.getElementById(prefix+'ShareStatus');status.textContent='';
    document.getElementById(prefix+'SharePdf').disabled=true;
    dialog.showModal();
    try{
      data=snapshot(document.querySelector('#gridViewport table'));
      if(!data.rows.length || data.rows.some(row=>row.cells.some(cell=>/Loading|Unable|failed/i.test(cell.content))))throw new Error('Wait for the inventory table to finish loading.');
      file=new File([pdf(data).output('blob')],`FarmVista-Grain-${isBins?'Bins':'Bags'}-${new Date().toISOString().slice(0,10)}.pdf`,{type:'application/pdf'});
      document.getElementById(prefix+'SharePdf').disabled=false;
      document.getElementById(prefix+'SharePrint').disabled=false;
    }catch(error){data=null;file=null;document.getElementById(prefix+'SharePrint').disabled=true;status.textContent=error.message || 'Could not prepare the report. Try again.';}
  });
  document.getElementById(prefix+'ShareClose').addEventListener('click',()=>dialog.close());
  document.getElementById(prefix+'SharePdf').addEventListener('click',async()=>{
    if(!file)return;
    try{
      if(navigator.canShare?.({files:[file]}))await navigator.share({files:[file],title});
      else{const url=URL.createObjectURL(file),link=document.createElement('a');link.href=url;link.download=file.name;link.click();setTimeout(()=>URL.revokeObjectURL(url),60000);document.getElementById(prefix+'ShareStatus').textContent='PDF downloaded. Attach it to your text or email.';}
      dialog.close();
    }catch(error){if(error.name!=='AbortError')document.getElementById(prefix+'ShareStatus').textContent='Could not share the PDF. Try again.';}
  });
  document.getElementById(prefix+'SharePrint').addEventListener('click',()=>{
    try{if(data){print(data);dialog.close();}}catch(error){document.getElementById(prefix+'ShareStatus').textContent=error.message;}
  });
})();
