// Full built frontend + real HTTP/auth/import/review/PostgreSQL. Synthetic data
// only. No QA URL, no production URL, no scheduler and no SMTP transport.
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import ExcelJS from 'exceljs';
const isolated=process.env.GES_BROWSER_TEST_DATABASE_URL;
assert.ok(isolated,'EXPLICIT_ISOLATED_DATABASE_REQUIRED');
const target=new URL(isolated);
assert.ok(target.hostname==='127.0.0.1'&&Number(target.port)>=55000&&target.pathname==='/ges_quality_browser'&&process.env.DATABASE_URL===isolated&&process.env.AUTO_EMAIL_ENABLED==='false'&&process.env.DATA_QUALITY_ENABLED==='true'&&process.env.IMPORT_RETENTION_ENABLED==='true','ISOLATED_DATABASE_GUARD');
const {prisma:db}=await import('../dist/src/db/prisma.js');
const {hashPassword}=await import('../dist/src/modules/auth/auth-service.js');
const {buildApp}=await import('../dist/src/app.js');
const directory=await fs.mkdtemp(path.join(tmpdir(),'ges-quality-browser-artifacts-'));
const root=path.resolve('..','dist'),profile=path.join(directory,'chrome');
const checks=[];let phase='identity',app,server,chrome,browser,page;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const pass=name=>{checks.push(name);console.log(JSON.stringify({check:name,passed:true}));};
class CDP{
 constructor(ws){this.ws=ws;this.next=0;this.pending=new Map();this.listeners=new Map();ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){const p=this.pending.get(m.id);this.pending.delete(m.id);m.error?p?.reject(Error(m.error.message)):p?.resolve(m.result);}else this.listeners.get(m.method)?.(m.params);});}
 static async connect(url){const ws=new WebSocket(url);await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true});});return new CDP(ws);}
 send(method,params={}){const id=++this.next;return new Promise((resolve,reject)=>{this.pending.set(id,{resolve,reject});this.ws.send(JSON.stringify({id,method,params}));});}
 on(name,listener){this.listeners.set(name,listener);}
 async evaluate(expression){const r=await this.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error('BROWSER_EVALUATION_FAILED:'+phase);return r.result.value;}
}
try{
 const [identity]=await db.$queryRaw`SELECT current_database() AS database,current_setting('cluster_name') AS cluster`;
 assert.deepEqual(identity,{database:'ges_quality_browser',cluster:'ges_quality_browser'});
 assert.equal(await db.garantia.count(),0);
 const password=randomBytes(24).toString('base64url'),passwordHash=await hashPassword(password);
 const users={};
 for(const rol of ['ADMIN','COORDINADOR_SOME','PROFESIONAL','LECTOR'])users[rol]=await db.usuario.create({data:{username:'flow-'+rol.toLowerCase(),nombre:'Cuenta ficticia '+rol,email:rol.toLowerCase()+'@example.test',rol,passwordHash,recibirInformeAutomatico:false}});
 let apiOrigin;
 server=http.createServer(async(req,res)=>{
  try{
   if(req.url.startsWith('/api/')){
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    const headers={...req.headers};delete headers.host;delete headers.connection;delete headers['content-length'];
    const response=await fetch(apiOrigin+req.url,{method:req.method,headers,body:['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(chunks),redirect:'manual'});
    res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return;
   }
   const relative=decodeURIComponent(new URL(req.url,'http://localhost').pathname),file=path.resolve(root,'.'+(relative==='/'?'/index.html':relative));
   if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
   const data=await fs.readFile(file);res.setHeader('Content-Type',file.endsWith('.html')?'text/html':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'application/octet-stream');res.end(data);
  }catch{res.writeHead(500);res.end('ISOLATED_TEST_SERVER_ERROR');}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const origin='http://127.0.0.1:'+server.address().port;
 process.env.CORS_ORIGINS=origin;
 app=buildApp();await app.listen({port:0,host:'127.0.0.1'});apiOrigin='http://127.0.0.1:'+app.server.address().port;
 const api=async(pathname,{cookie,method='GET',body,headers={}}={})=>{
  const response=await fetch(apiOrigin+pathname,{method,headers:{Origin:origin,...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{}),...headers},body:body?JSON.stringify(body):undefined});
  const value=await response.json();return {status:response.status,value,cookie:response.headers.get('set-cookie')?.split(';')[0]};
 };
 const cookies={};
 for(const rol of Object.keys(users)){const r=await api('/api/auth/login',{method:'POST',body:{username:users[rol].username,password}});assert.equal(r.status,200);cookies[rol]=r.cookie;}
 for(const rol of Object.keys(users)){
  const expected=['ADMIN','COORDINADOR_SOME'].includes(rol)?200:403;
  assert.equal((await api('/api/calidad-datos/pendientes',{cookie:cookies[rol]})).status,expected);
  assert.equal((await api('/api/calidad-datos/decisiones',{cookie:cookies[rol]})).status,expected);
 }
 assert.equal((await api('/api/calidad-datos/pendientes')).status,401);pass('real_login_and_http_access_for_all_four_roles');
 const rows=(numbers,change={})=>numbers.map(n=>{
  const rut=String(99000000+n);let sum=0,factor=2;for(const d of [...rut].reverse()){sum+=Number(d)*factor;factor=factor===7?2:factor+1;}const dv=11-sum%11;
  return ['PROBLEMA_FICTICIO_CALIDAD',rut,change.invalid?'X':dv===11?'0':dv===10?'K':String(dv),'PACIENTE_FICTICIO_CALIDAD_'+n,change.start??'2027-01-01',change.limit??'2027-02-28',0,'GARANTIA_FICTICIA_CALIDAD',change.responsible??'CENTRO_FICTICIO_1'];
 });
 async function workbook(name,values){const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('Nómina ficticia');sheet.addRow(['Problema de salud','RUT','DV','Nombre','Fecha de Inicio','Fecha Limite','Dias que faltan para el Vencimiento de la Garantia','Nombre de la garantia','Responsable de la garantia']);values.forEach(row=>sheet.addRow(row));const filename=path.join(directory,name);await book.xlsx.writeFile(filename);return filename;}
 const base=await workbook('01-base-ficticia.xlsx',rows([1,2,3]));
 const safe=rows([3],{limit:'2027-03-15',responsible:'CENTRO_FICTICIO_2'})[0];
 const next=await workbook('02-coincidencias-ficticias.xlsx',[...rows([1,2],{start:'2027-01-02'}),safe,safe,...rows([4],{invalid:true})]);
 await fs.mkdir(profile);
 const binaries=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'];
 let binary;for(const b of binaries){try{await fs.access(b);binary=b;break;}catch{}}
 assert.ok(binary,'CHROMIUM_BROWSER_REQUIRED');
 chrome=spawn(binary,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-address=127.0.0.1','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:'ignore'});
 let active;for(let n=0;n<150;n++){try{active=(await fs.readFile(path.join(profile,'DevToolsActivePort'),'utf8')).trim().split('\n');break;}catch{await sleep(50);}}
 assert.ok(active,'BROWSER_STARTUP');browser=await CDP.connect(`ws://127.0.0.1:${active[0]}${active[1]}`);
 const tab=await browser.send('Target.createTarget',{url:'about:blank'}),tabs=await(await fetch(`http://127.0.0.1:${active[0]}/json/list`)).json();
 page=await CDP.connect(tabs.find(t=>t.id===tab.targetId).webSocketDebuggerUrl);
 const errors=[];page.on('Runtime.exceptionThrown',()=>errors.push('RUNTIME_EXCEPTION'));
 page.on('Fetch.requestPaused',async({requestId,request})=>{const u=new URL(request.url);if(u.origin===origin)await page.send('Fetch.continueRequest',{requestId});else await page.send('Fetch.fulfillRequest',{requestId,responseCode:200,body:''});});
 await page.send('Page.enable');await page.send('Runtime.enable');await page.send('DOM.enable');await page.send('Fetch.enable',{patterns:[{urlPattern:'*'}]});
 await page.send('Emulation.setDeviceMetricsOverride',{width:1360,height:940,deviceScaleFactor:1,mobile:false});
 await page.send('Page.navigate',{url:origin});
 async function until(expression){for(let n=0;n<160;n++){if(await page.evaluate(expression))return;await sleep(50);}throw Error('UI_TIMEOUT:'+phase+':'+expression);}
 const clickText=async text=>{const clicked=await page.evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()===${JSON.stringify(text)});if(!b)return false;b.click();return true})()`);assert.ok(clicked,'BUTTON_NOT_FOUND:'+text);};
 const setInput=async(selector,value)=>{await page.evaluate(`(()=>{const x=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(x.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(x,${JSON.stringify(value)});x.dispatchEvent(new Event('input',{bubbles:true}));})()`);await sleep(30);};
 const nav=async name=>{await page.evaluate(`document.querySelector('button[title='+${JSON.stringify(JSON.stringify(name))}+']').click()`);};
 const screenshot=async name=>fs.writeFile(path.join(directory,name+'.png'),Buffer.from((await page.send('Page.captureScreenshot',{format:'png'})).data,'base64'));
 async function login(role){await until(`!!document.querySelector('input[autocomplete="username"]')`);await setInput('input[autocomplete="username"]',users[role].username);await setInput('input[autocomplete="current-password"]',password);await page.evaluate(`document.querySelector('button[type="submit"]').click()`);await until(`!!document.querySelector('button[title="Cerrar sesión"]')`);}
 phase='browser_login';await login('ADMIN');await nav('Calidad de datos');await until(`document.body.textContent.includes('No hay filas pendientes')`);await screenshot('01-empty');pass('built_frontend_real_login_independent_menu_and_empty_state');
 async function importFromBrowser(filename){await nav('Importar nómina');await until(`!!document.querySelector('input[type="file"]')`);const doc=await page.send('DOM.getDocument'),node=await page.send('DOM.querySelector',{nodeId:doc.root.nodeId,selector:'input[type="file"]'});await page.send('DOM.setFileInputFiles',{nodeId:node.nodeId,files:[filename]});await until(`[...document.querySelectorAll('button')].some(x=>x.textContent.trim()==='Validar archivo')`);await clickText('Validar archivo');await until(`[...document.querySelectorAll('button')].some(x=>x.textContent.trim()==='Confirmar e importar')`);await clickText('Confirmar e importar');await until(`document.body.textContent.includes('Importación completada')`);}
 phase='base_import';await importFromBrowser(base);assert.equal(await db.garantia.count(),3);pass('base_xlsx_imported_through_real_ui_creates_three_guarantees');
 const originals=await db.garantia.findMany({include:{paciente:true},orderBy:{paciente:{rutNumero:'asc'}}});
 // Create a real management action through the existing endpoint, to verify it
 // survives both retention and the supervisor's MISMA decision.
 const managed=await api(`/api/garantias/${originals[0].id}/gestion`,{cookie:cookies.ADMIN,method:'POST',body:{tipoActuacion:'CITACION',comentario:'Gestión completamente ficticia que debe conservarse',revisionGestion:0}});assert.equal(managed.status,200);
 const snapshot=async id=>JSON.stringify(await db.garantia.findUniqueOrThrow({where:{id},include:{paciente:true,eventos:true}}));
 const beforeSame=await snapshot(originals[0].id),beforeDistinct=await snapshot(originals[1].id);
 phase='coincidences_import';await importFromBrowser(next);
 const imported=await db.importacion.findFirstOrThrow({where:{nombreArchivo:'02-coincidencias-ficticias.xlsx'},include:{controlRetencion:true}});
 assert.equal(await db.garantia.count(),3);assert.equal(imported.registrosActualizados,1);assert.equal(imported.controlRetencion.registrosPendientesRevision,2);assert.equal(imported.controlRetencion.registrosRepetidosOmitidos,1);assert.equal(imported.controlRetencion.registrosInvalidos,1);
 assert.equal(await snapshot(originals[0].id),beforeSame);assert.equal(await snapshot(originals[1].id),beforeDistinct);
 const updated=await db.garantia.findUniqueOrThrow({where:{id:originals[2].id}});assert.equal(updated.fechaLimite.toISOString().slice(0,10),'2027-03-15');assert.equal(updated.responsable,'CENTRO_FICTICIO_2');pass('ambiguous_rows_retained_safe_update_duplicate_omission_invalid_row_and_counters');
 await nav('Calidad de datos');await until(`document.body.textContent.includes('2 pendientes')`);await screenshot('02-pending');
 const pending=(await api('/api/calidad-datos/pendientes',{cookie:cookies.ADMIN})).value.data;
 const first=pending.find(x=>x.nombre.endsWith('_1')),second=pending.find(x=>x.nombre.endsWith('_2'));
 async function openRow(number){await page.evaluate(`document.querySelector('button[aria-label^="Revisar fila ${number} "]').click()`);await until(`!!document.querySelector('dialog[open] input[type="radio"]')`);}
 phase='modal';await openRow(first.numeroFila);
 assert.equal(await page.evaluate(`document.querySelectorAll('dialog input[type="radio"]:checked').length`),0);
 assert.equal(await page.evaluate(`document.querySelector('dialog button[type="submit"]').disabled`),true);
 const desktop=await page.evaluate(`(()=>{const d=document.querySelector('dialog'),s=[...d.querySelectorAll('section')].map(x=>{const r=x.getBoundingClientRect();return {label:x.getAttribute('aria-label'),x:r.x,y:r.y,width:r.width}});return {width:d.getBoundingClientRect().width,sections:s,backdrop:getComputedStyle(d,'::backdrop').backgroundColor,highlights:d.querySelectorAll('dd.ring-inset').length}})()`);
 assert.deepEqual(desktop.sections.map(s=>s.label),['Garantía existente','Nueva nómina']);assert.ok(desktop.sections[0].x<desktop.sections[1].x);assert.equal(desktop.sections[0].y,desktop.sections[1].y);assert.ok(desktop.highlights>0);assert.notEqual(desktop.backdrop,'rgba(0, 0, 0, 0)');await screenshot('03-modal-desktop');
 await page.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await sleep(100);
 const mobile=await page.evaluate(`(()=>{const d=document.querySelector('dialog'),s=[...d.querySelectorAll('section')].map(x=>{const r=x.getBoundingClientRect();return {x:r.x,y:r.y}});return {width:d.getBoundingClientRect().width,scrollWidth:document.documentElement.scrollWidth,sections:s}})()`);
 assert.ok(mobile.width<=390);assert.equal(mobile.sections[0].x,mobile.sections[1].x);assert.ok(mobile.sections[1].y>mobile.sections[0].y);assert.equal(mobile.scrollWidth,390);await screenshot('04-modal-mobile');
 await page.send('Emulation.setDeviceMetricsOverride',{width:1360,height:940,deviceScaleFactor:1,mobile:false});
 await page.evaluate(`document.querySelector('button[aria-label="Cerrar revisión"]').click()`);await until(`!document.querySelector('dialog')`);assert.equal((await api('/api/calidad-datos/pendientes',{cookie:cookies.ADMIN})).value.pendientesTotales,2);pass('approved_modal_geometry_highlights_mobile_no_preselection_close_keeps_pending');
 const commands=[];page.on('Network.requestWillBeSent',p=>{if(p.request.url.endsWith('/resolver'))commands.push({url:p.request.url,body:JSON.parse(p.request.postData)});});await page.send('Network.enable');
 async function decide(number,decision){await openRow(number);await page.evaluate(`document.querySelector('input[value="${decision}"]').click()`);assert.equal(await page.evaluate(`document.querySelector('dialog button[type="submit"]').disabled`),true);await setInput('dialog textarea','Revisión ficticia confirmada en prueba integral '+decision);await until(`!document.querySelector('dialog button[type="submit"]').disabled`);await page.evaluate(`document.querySelector('dialog button[type="submit"]').click()`);await until(`document.querySelector('dialog').textContent.includes('Decisión registrada.')`);await screenshot('05-result-'+decision);await page.evaluate(`document.querySelector('button[aria-label="Cerrar revisión"]').click()`);await until(`!document.querySelector('dialog')`);}
 phase='same';await decide(first.numeroFila,'MISMA');assert.equal(await db.garantia.count(),3);assert.equal(await snapshot(originals[0].id),beforeSame);await until(`document.body.textContent.includes('1 pendiente')`);pass('MISMA_from_modal_preserves_identifier_dates_responsible_management_and_history');
 phase='distinct';await decide(second.numeroFila,'DISTINTA');assert.equal(await db.garantia.count(),4);assert.equal(await snapshot(originals[1].id),beforeDistinct);await until(`document.body.textContent.includes('No hay filas pendientes')`);
 const resolution=await db.resolucionFilaImportacion.findUniqueOrThrow({where:{filaId:second.id}}),created=await db.garantia.findUniqueOrThrow({where:{id:resolution.garantiaResultadoId},include:{eventos:true}});
 assert.equal(created.estadoGestion,'SIN_GESTION');assert.equal(created.revisionGestion,0);assert.equal(created.eventos.length,0);assert.equal(created.fechaInicio.toISOString().slice(0,10),'2027-01-02');pass('DISTINTA_from_modal_creates_exactly_one_clean_guarantee_and_preserves_existing');
 phase='history';await page.evaluate(`document.querySelector('details summary').click()`);await until(`document.body.textContent.includes('MISMA · Garantía conservada')&&document.body.textContent.includes('DISTINTA · Nueva garantía')`);await screenshot('06-decisions-history');
 await nav('Supervisión SOME');await until(`[...document.querySelectorAll('button')].some(x=>x.textContent.trim()==='Gestiones y cambios')`);assert.ok(await page.evaluate(`['Resumen','Responsabilidades','Gestiones y cambios'].every(t=>[...document.querySelectorAll('button')].some(x=>x.textContent.trim()===t))`));await clickText('Gestiones y cambios');await until(`document.body.textContent.includes('Revisión de importación')`);
 const activity=(await api('/api/supervision/eventos',{cookie:cookies.ADMIN})).value;
 const events=activity.eventos??activity.data?.eventos;assert.equal(events.filter(e=>e.tipo==='REVISION_IMPORTACION').length,2);assert.ok(events.filter(e=>e.tipo==='REVISION_IMPORTACION').every(e=>e.tipoActuacion===null&&e.secuencia===null));assert.equal(await db.eventoGarantia.count(),1);await screenshot('07-supervision');pass('both_decisions_in_quality_history_and_global_SOME_timeline_without_fake_management');
 phase='retries';for(const command of commands){const result=await api(new URL(command.url).pathname,{cookie:cookies.ADMIN,method:'POST',body:command.body});assert.equal(result.status,200);assert.equal(result.value.data.repetida,true);}assert.equal(await db.garantia.count(),4);pass('retrying_actual_browser_payloads_does_not_duplicate_guarantees');
 await nav('Cerrar sesión');await until(`!!document.querySelector('input[autocomplete="username"]')`);await login('ADMIN');await nav('Calidad de datos');await until(`document.body.textContent.includes('No hay filas pendientes')`);await page.evaluate(`document.querySelector('details summary').click()`);await until(`document.body.textContent.includes('MISMA · Garantía conservada')&&document.body.textContent.includes('DISTINTA · Nueva garantía')`);pass('real_logout_login_preserves_resolutions');
 phase='contradictions_and_concurrency';
 const upload=async filename=>{const form=new FormData();form.append('archivo',new Blob([await fs.readFile(filename)]),path.basename(filename));const r=await fetch(apiOrigin+'/api/importaciones/',{method:'POST',headers:{Origin:origin,Cookie:cookies.ADMIN,'X-Import-Request-Id':randomUUID()},body:form});assert.equal(r.status,201);return(await r.json()).data;};
 phase='source_update';
 const updateBefore=await db.garantia.findUniqueOrThrow({where:{id:originals[0].id},include:{paciente:true,eventos:true}}),updateCount=await db.garantia.count();
 const updateFile=await workbook('03-actualizacion-ficticia.xlsx',rows([1],{start:'2027-01-04',limit:'2027-04-01',responsible:'CENTRO_FICTICIO_3'}));
 const updateImport=await upload(updateFile),updatePending=await db.filaImportacion.findFirstOrThrow({where:{importacionId:updateImport.id}});
 await nav('Calidad de datos');await until(`document.body.textContent.includes('1 pendiente')`);await openRow(updatePending.numeroFila);
 assert.equal(await page.evaluate(`document.querySelectorAll('dialog input[type="radio"]').length`),3);assert.equal(await page.evaluate(`document.querySelectorAll('dialog input[type="radio"]:checked').length`),0);await screenshot('09-modal-three-decisions');
 await page.evaluate(`document.querySelector('button[aria-label="Cerrar revisión"]').click()`);await until(`!document.querySelector('dialog')`);
 await decide(updatePending.numeroFila,'ACTUALIZAR');await until(`document.body.textContent.includes('No hay filas pendientes')`);
 const updateAfter=await db.garantia.findUniqueOrThrow({where:{id:originals[0].id},include:{paciente:true,eventos:true}});
 assert.equal(updateAfter.fechaInicio.toISOString().slice(0,10),'2027-01-04');assert.equal(updateAfter.fechaLimite.toISOString().slice(0,10),'2027-04-01');assert.equal(updateAfter.responsable,'CENTRO_FICTICIO_3');assert.equal(updateAfter.version,updateBefore.version+1);assert.equal(await db.garantia.count(),updateCount);
 assert.deepEqual({...updateAfter,fechaInicio:updateBefore.fechaInicio,fechaLimite:updateBefore.fechaLimite,responsable:updateBefore.responsable,version:updateBefore.version,updatedAt:updateBefore.updatedAt},updateBefore);
 const updateCommand=commands.find(c=>c.body.actualizarDatos===true);assert.ok(updateCommand);assert.equal(updateCommand.body.decision,'MISMA');
 const updateReplay=await api(new URL(updateCommand.url).pathname,{cookie:cookies.ADMIN,method:'POST',body:updateCommand.body});assert.equal(updateReplay.status,200);assert.equal(updateReplay.value.data.repetida,true);assert.equal(updateReplay.value.data.resolucion.actualizarDatos,true);assert.equal((await db.garantia.findUniqueOrThrow({where:{id:originals[0].id}})).version,updateAfter.version);
 await page.evaluate(`document.querySelector('details summary').click()`);await until(`document.body.textContent.includes('Datos actualizados · Gestión conservada')`);await screenshot('10-source-update-history');
 await nav('Supervisión SOME');await until(`[...document.querySelectorAll('button')].some(x=>x.textContent.trim()==='Gestiones y cambios')`);await clickText('Gestiones y cambios');await until(`document.body.textContent.includes('Datos actualizados · Gestión conservada')`);await screenshot('11-source-update-supervision');
 const updateFeed=(await api('/api/supervision/eventos',{cookie:cookies.ADMIN})).value;const updateEvents=updateFeed.eventos??updateFeed.data?.eventos;const updateEvent=updateEvents.find(e=>e.revisionImportacion?.actualizarDatos===true);assert.ok(updateEvent);assert.equal(updateEvent.garantia.id,originals[0].id);assert.equal(updateEvent.tipoActuacion,null);assert.equal(await db.eventoGarantia.count(),1);
 pass('third_modal_decision_updates_source_preserves_patient_management_history_and_is_idempotent');
 pass('source_update_is_distinguished_in_both_real_history_views_without_management_events');
 phase='contradictions_and_concurrency';
 const conflicting=await workbook('04-contradicciones-ficticias.xlsx',[...rows([5]),...rows([5],{limit:'2027-03-01'})]);const countBefore=await db.garantia.count();await upload(conflicting);assert.equal(await db.garantia.count(),countBefore);const conflicts=await db.filaImportacion.findMany({where:{datosValidados:{path:['rut'],equals:'99000005'}}});assert.equal(conflicts.length,2);assert.ok(conflicts.every(x=>x.motivos.includes('FILAS_CONTRADICTORIAS')));pass('whole_file_contradictions_retained_before_any_guarantee_write');
 const raceFile=await workbook('04-concurrencia-ficticia.xlsx',rows([1],{start:'2027-01-03'})),raceImport=await upload(raceFile),raceRow=await db.filaImportacion.findFirstOrThrow({where:{importacionId:raceImport.id}}),raceDetail=(await api('/api/calidad-datos/pendientes/'+raceRow.id,{cookie:cookies.ADMIN})).value.data;
 const common={version:raceDetail.version,huellaRevision:raceDetail.huellaRevision,justificacion:'Decisión simultánea completamente ficticia'};
 const race=await Promise.all([api(`/api/calidad-datos/pendientes/${raceRow.id}/resolver`,{cookie:cookies.ADMIN,method:'POST',body:{...common,solicitudId:randomUUID(),decision:'MISMA',garantiaExistenteId:originals[0].id}}),api(`/api/calidad-datos/pendientes/${raceRow.id}/resolver`,{cookie:cookies.COORDINADOR_SOME,method:'POST',body:{...common,solicitudId:randomUUID(),decision:'DISTINTA',confirmaDistintaDeTodas:true}})]);
 assert.deepEqual(race.map(x=>x.status).sort(),[200,409]);assert.equal(await db.resolucionFilaImportacion.count({where:{filaId:raceRow.id}}),1);
 const winner=await db.resolucionFilaImportacion.findUniqueOrThrow({where:{filaId:raceRow.id}});
 assert.equal(await db.garantia.count(),countBefore+(winner.decision==='DISTINTA'?1:0));
 pass('two_authenticated_supervisors_cannot_commit_opposing_decisions');
 phase='stale_modal';await nav('Calidad de datos');await until(`!!document.querySelector('button[aria-label^="Revisar fila"]')`);
 await page.evaluate(`document.querySelector('button[aria-label^="Revisar fila"]').click()`);await until(`!!document.querySelector('dialog input[value="DISTINTA"]')`);
 await page.evaluate(`document.querySelector('input[value="DISTINTA"]').click()`);await setInput('dialog textarea','Justificación ficticia para probar conflicto real');
 // Retained-row version is a real concurrency token; this simulates another
 // reviewer changing the row while this browser holds an older detail.
 const remaining=(await api('/api/calidad-datos/pendientes',{cookie:cookies.ADMIN})).value.data;
 await db.filaImportacion.updateMany({where:{id:{in:remaining.map(x=>x.id)}},data:{version:{increment:1}}});
 await page.evaluate(`document.querySelector('dialog button[type="submit"]').click()`);await until(`!!document.querySelector('dialog [role="alert"]')`);assert.ok(await page.evaluate(`document.querySelector('dialog button[type="submit"]').disabled`));await screenshot('08-real-conflict');await clickText('Actualizar datos');await until(`!!document.querySelector('dialog input[value="DISTINTA"]')&&!document.querySelector('dialog [role="alert"]')`);assert.equal(await page.evaluate(`document.querySelectorAll('dialog input[type="radio"]:checked').length`),0);pass('real_conflict_disables_submit_and_reload_requires_new_decision');
 await page.evaluate(`document.querySelector('button[aria-label="Cerrar revisión"]').click()`);
 for(const role of ['COORDINADOR_SOME','PROFESIONAL','LECTOR']){await nav('Cerrar sesión');await login(role);assert.equal(await page.evaluate(`!!document.querySelector('button[title="Calidad de datos"]')`),role==='COORDINADOR_SOME');}
 assert.deepEqual(errors,[]);pass('browser_navigation_permissions_match_backend_roles_and_no_runtime_errors');
 const result={passed:true,database:'ges_quality_browser',syntheticDataOnly:true,qaAccessed:false,smtpTransportCreated:false,checks:checks.length,scenarios:checks,desktop,mobile,artifacts:directory};await fs.writeFile(path.join(directory,'result.json'),JSON.stringify(result,null,2));await fs.writeFile('.tmp-final-quality-browser-result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}catch(error){await fs.writeFile(path.join(directory,'failure.json'),JSON.stringify({phase,error:error.message,checks}));if(page)await fs.writeFile(path.join(directory,'failure-dom.txt'),await page.evaluate('document.body.innerText').catch(()=>''));console.error(JSON.stringify({passed:false,phase,error:error.message,artifacts:directory}));process.exitCode=1;}
finally{try{await browser?.send('Browser.close');}catch{}page?.ws.close();browser?.ws.close();chrome?.kill();if(server)await new Promise(r=>server.close(r));await app?.close();await db.$disconnect();}
