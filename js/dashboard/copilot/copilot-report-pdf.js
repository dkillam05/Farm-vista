const GREEN=[47,108,60], INK=[27,43,33], MUTED=[92,107,97], GOLD=[199,187,62];
const text=value=>String(value ?? '').replace(/[\u2010-\u2015]/g,'-').replace(/[\u2018\u2019]/g,"'").replace(/[\u201c\u201d]/g,'"').replace(/\u2026/g,'...').replace(/\u00a0/g,' ');
export function reportTimestamp(value) {
  const date=new Date(value);
  if(!Number.isFinite(date.getTime()))throw new Error('The report date is invalid.');
  return new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(date);
}
export function reportFilename(report) {
  return 'FarmVista-'+report.title.replace(/[^a-zA-Z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,75)+'-'+report.asOf.slice(0,10)+'.pdf';
}
export function validateReport(report) {
  if(report?.version!==1 || typeof report.title!=='string' || !report.source?.label || !Array.isArray(report.rows) || report.rows.length!==report.recordCount || report.rows.length>1000 || !Array.isArray(report.columns) || report.columns.length<1 || report.columns.length>10) throw new Error('The complete report is unavailable. Please generate it again.');
  if(report.rows.some(row=>!Array.isArray(row) || row.length!==report.columns.length))throw new Error('The report table is incomplete. Please generate it again.');
  reportTimestamp(report.asOf);
  return report;
}
export function buildReportPdf({report,branding,jsPDF,preparedAt=new Date()}) {
  validateReport(report);
  const landscape=report.columns.length>=8;
  const pdf=new jsPDF({orientation:landscape?'landscape':'portrait',unit:'pt',format:'letter',compress:true});
  if(typeof pdf.autoTable!=='function')throw new Error('The PDF table tools did not load. Please try again.');
  const width=pdf.internal.pageSize.getWidth(),height=pdf.internal.pageSize.getHeight(),margin=34;
  pdf.setProperties({title:text(report.title),subject:'FarmVista report from current records',author:text(branding.name || 'FarmVista'),creator:'FarmVista Copilot'});
  pdf.setFont('helvetica','bold');pdf.setFontSize(15);
  const companyLines=pdf.splitTextToSize(text(branding.name || 'FarmVista'),width-170);
  const headerBottom=Math.max(100,38+companyLines.length*17+34);
  const tableDefaults={margin:{top:headerBottom+14,right:margin,bottom:44,left:margin},theme:'striped',
    styles:{font:'helvetica',fontSize:9,cellPadding:6,overflow:'linebreak',textColor:INK,lineColor:[219,225,220],lineWidth:.3},
    headStyles:{fillColor:GREEN,textColor:[255,255,255],fontStyle:'bold'},alternateRowStyles:{fillColor:[245,248,244]},
    showHead:'everyPage',rowPageBreak:'avoid'};
  let y=headerBottom+22;
  pdf.setFont('helvetica','bold');pdf.setFontSize(21);pdf.setTextColor(...INK);
  const titleLines=pdf.splitTextToSize(text(report.title),width-margin*2);
  pdf.text(titleLines,margin,y);y+=titleLines.length*24+4;
  pdf.setFont('helvetica','normal');pdf.setFontSize(9);pdf.setTextColor(...MUTED);
  const scope=pdf.splitTextToSize((report.scope || []).map(text).join(' | '),width-margin*2);
  pdf.text(scope,margin,y);y+=scope.length*12+17;
  const sections=report.sections || [];
  if(sections.length){
    const labels=sections[0].metrics.map(metric=>text(metric.label));
    pdf.autoTable({...tableDefaults,startY:y,head:[['Scope','Records',...labels]],
      body:sections.map(section=>[text(section.label),String(section.count),...section.metrics.map(metric=>text(metric.value)+(metric.detail?'\n'+text(metric.detail):''))]),
      styles:{...tableDefaults.styles,fontSize:9},columnStyles:{0:{fontStyle:'bold'}}});
    y=pdf.lastAutoTable.finalY+22;
  }
  if(y>height-105){pdf.addPage();y=headerBottom+22;}
  pdf.setTextColor(...INK);pdf.setFont('helvetica','bold');pdf.setFontSize(12);
  pdf.text(`Matching records (${report.recordCount})`,margin,y);y+=10;
  if(report.rows.length){
    const columnStyles=Object.fromEntries(report.columns.map((column,i)=>[i,column.numeric?{halign:'right'}:{}]));
    pdf.autoTable({...tableDefaults,startY:y,head:[report.columns.map(column=>text(column.label))],body:report.rows.map(row=>row.map(text)),columnStyles});
    y=pdf.lastAutoTable.finalY+18;
  }
  const notes=[...(report.notes || []),'Source: '+report.source.label+'. The report contains current matching records, not a transcript of the chat.'];
  pdf.setFont('helvetica','normal');pdf.setFontSize(8);pdf.setTextColor(...MUTED);
  for(const note of notes){
    const lines=pdf.splitTextToSize(text(note),width-margin*2);
    if(y+lines.length*11>height-46){pdf.addPage();y=headerBottom+22;}
    pdf.text(lines,margin,y);y+=lines.length*11+6;
  }
  const pages=pdf.internal.getNumberOfPages();
  for(let page=1;page<=pages;page++){
    pdf.setPage(page);
    if(branding.logoData){
      const ratio=branding.logoWidth/branding.logoHeight || 1;
      const logoWidth=Math.min(64,56*ratio),logoHeight=logoWidth/ratio;
      pdf.addImage(branding.logoData,'PNG',margin+(64-logoWidth)/2,26+(56-logoHeight)/2,logoWidth,logoHeight,'company-logo');
    } else {
      pdf.setTextColor(...GREEN);pdf.setFont('helvetica','bold');pdf.setFontSize(11);pdf.text('FarmVista',margin,53);
    }
    pdf.setFont('helvetica','bold');pdf.setFontSize(15);pdf.setTextColor(...INK);pdf.text(companyLines,110,39);
    pdf.setFont('helvetica','normal');pdf.setFontSize(8);pdf.setTextColor(...MUTED);
    pdf.text('Prepared: '+reportTimestamp(preparedAt),110,39+companyLines.length*17+3);
    pdf.text('Records checked: '+reportTimestamp(report.asOf),110,39+companyLines.length*17+15);
    pdf.setDrawColor(...GOLD);pdf.setLineWidth(2);pdf.line(margin,headerBottom,width-margin,headerBottom);
    pdf.setDrawColor(219,225,220);pdf.setLineWidth(.5);pdf.line(margin,height-34,width-margin,height-34);
    pdf.setFontSize(8);pdf.setTextColor(...MUTED);pdf.text('FarmVista | '+text(report.title),margin,height-20);
    pdf.text(`${page} / ${pages}`,width-margin,height-20,{align:'right'});
  }
  return pdf;
}
