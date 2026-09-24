import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('../js/dashboard/copilot/copilot-report-pdf.js',import.meta.url),'utf8');
const {buildReportPdf,reportTimestamp,validateReport}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const context={console,atob,btoa,TextEncoder,TextDecoder,Blob,Uint8Array,ArrayBuffer,navigator:{userAgent:'node'}};
context.window=context;context.self=context;vm.createContext(context);
for(const file of ['jspdf.umd.min.js','jspdf.plugin.autotable.min.js'])vm.runInContext(await readFile(new URL('../js/vendor/'+file,import.meta.url),'utf8'),context);
const report={version:1,title:'Field Summary',asOf:'2026-09-24T12:09:00Z',recordCount:1,rows:[['North','42']],columns:[{label:'Field'},{label:'HEL acres',numeric:true}],scope:['Active records'],sections:[],notes:[],source:{label:'Fields'}};
test('report dates consistently use Central Time, including winter and midnight boundaries',()=>{
  assert.match(reportTimestamp(report.asOf),/Sep 24, 2026.*7:09 AM CDT/);
  assert.match(reportTimestamp('2026-01-01T05:30:00Z'),/Dec 31, 2025.*11:30 PM CST/);
});
test('PDF uses a real logo, company header, timestamps, table and page count',async()=>{
  const logo=await readFile(new URL('../assets/icons/logo.png',import.meta.url));
  const pdf=buildReportPdf({report,branding:{name:'Dowson Farms',logoData:'data:image/png;base64,'+logo.toString('base64'),logoWidth:512,logoHeight:512},jsPDF:context.jspdf.jsPDF,preparedAt:'2026-09-24T13:00:00Z'});
  assert.equal(pdf.internal.getNumberOfPages(),1);
  assert.equal(Object.keys(pdf.internal.collections.addImage_images).length,1);
  const commands=pdf.internal.pages[1].join('\n');
  for(const value of ['Dowson Farms','Prepared:','Records checked:','North','HEL acres','1 / 1'])assert.ok(commands.includes(value),value);
  assert.ok(pdf.output('arraybuffer').byteLength>2000);
});
test('multipage PDFs repeat branding and table headings without losing the last record',()=>{
  const rows=Array.from({length:125},(_,i)=>['Field '+i,i===124?'Unknown':String(i)]);
  const pdf=buildReportPdf({report:{...report,recordCount:rows.length,rows},branding:{name:'Dowson Farms'},jsPDF:context.jspdf.jsPDF});
  const pages=pdf.internal.pages.slice(1);
  assert.ok(pages.length>1);
  for(const page of pages){assert.ok(page.join('\n').includes('Dowson Farms'));assert.ok(page.join('\n').includes('HEL acres'));}
  assert.ok(pages.at(-1).join('\n').includes('Field 124'));
  assert.ok(pages.at(-1).join('\n').includes('Unknown'));
});
test('incomplete report payloads are rejected before rendering',()=>{
  assert.throws(()=>validateReport({...report,recordCount:2}),/complete report/);
  assert.throws(()=>validateReport({...report,rows:[['Missing column']]}),/table is incomplete/);
});
test('agronomic reports retain exact hybrid labels, units and coverage warnings in landscape tables',()=>{
  const columns=['Field','Crop','Activity dates','Recorded variety / product','Kind','Worked ac','Applied ac','Actual total','Recorded rate / yield'].map(label=>({label}));
  const rows=Array.from({length:80},(_,i)=>['0707-Tri D North','corn','2026-04-14 to 2026-04-14',i%2?'Dekalb 114-42SSP (BLUEPRINT)':'Dekalb 114-42SSP','variety',i%2?'95.7':'101.5','Unknown','Unknown','34,804 seeds1ac-1']);
  const pdf=buildReportPdf({report:{...report,title:'Deere Seed Varieties',columns,rows,recordCount:rows.length,source:{label:'John Deere agronomic operations'},notes:['Areas are recorded operation acres, not unique land.','Incomplete coverage: one operation has unknown dates.']},branding:{name:'Dowson Farms'},jsPDF:context.jspdf.jsPDF});
  assert.ok(pdf.internal.pageSize.getWidth()>pdf.internal.pageSize.getHeight());
  const content=pdf.internal.pages.slice(1).map(page=>page.join('\n')).join('\n');
  for(const value of ['BLUEPRINT','101.5','95.7','Unknown','Incomplete coverage:','John Deere agronomic operations'])assert.ok(content.includes(value),value);
  assert.ok(pdf.internal.getNumberOfPages()>1);
});
