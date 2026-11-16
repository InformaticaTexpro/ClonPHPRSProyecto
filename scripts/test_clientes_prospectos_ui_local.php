<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(403); exit; }
// Chrome sin interfaz, perfil temporal, datos ficticios y fetch simulado. Sin .env ni correo.
require_once dirname(__DIR__) . '/api/src/ClienteSolicitudesService.php';
$root = dirname(__DIR__);
$temp = sys_get_temp_dir() . '/gicotex-prospectos-ui-' . bin2hex(random_bytes(6));
mkdir($temp);
$schema = json_encode(['campos_ficha'=>ClienteSolicitudesService::FICHA,'campos_internos'=>ClienteSolicitudesService::INTERNOS],JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
$shared = file_get_contents($root . '/src/assets/js/clientes-prospectos.js');
$mock = <<<'JS'
const $=id=>document.getElementById(id);
const gestion=!!$('filterType');
let closeEvents=0;document.addEventListener('close',()=>closeEvents++,true);window.addEventListener('unhandledrejection',event=>{document.body.dataset.testError=String(event.reason);});window.addEventListener('error',event=>{document.body.dataset.testError=event.message;});
const initial={id:1,tipo:'PROSPECTO',estado:'BORRADOR',creado_en:'2026-11-12',vendedor_nombre:'Vendedor TEST',codigo_vendedor:'246',rut_original:'12345678-5',razon_social:'<Cliente TEST>',contacto_nombre:'Contacto',contacto_email:'test@example.test',telefono:'123',productos_interes:'Productos',codigo_auxiliar_softland:'AUX-TEST'};
let row={...initial,estado:gestion?'PENDIENTE':'BORRADOR'}, savedInternal=null, savedResponsible=null, listReads=0, summaries=0, writes=0, nextError=false, lookupActive=null, lookupOrigin=null, sourceSnapshot=null, nextFichaId=2, cliSequence=0;
const responsible={id:1,nombre:'Responsable TEST',email:'test@example.test',recibe_prospecto:1,recibe_ficha:1,recibe_correo:1,activo:1};
const catalogs={ORIGEN:[{id:10,tipo:'ORIGEN',codigo:'WEB_TEST',nombre:'Web de prueba API',orden:1,activo:1,puede_eliminar:1},{id:11,tipo:'ORIGEN',codigo:'USADO',nombre:'Origen utilizado',orden:2,activo:1,puede_eliminar:0}],RUBRO:[{id:20,tipo:'RUBRO',codigo:'METALURGICA',nombre:'Metalúrgica',orden:1,activo:1,puede_eliminar:1},{id:21,tipo:'RUBRO',codigo:'OTROS',nombre:'Otros',orden:2,activo:1,puede_eliminar:1}],FORMA_PAGO:[{id:30,tipo:'FORMA_PAGO',codigo:'CONTADO',nombre:'Contado',orden:1,activo:1,puede_eliminar:1}]};
window.fetch=async(url,options={})=>{
 const u=new URL(url,'http://localhost');const p=u.pathname.replace('/api/clientes-prospectos','');
 const body=options.body?JSON.parse(options.body):{};let data={ok:true};
 if(p==='/contexto'&&(SCENARIO.includes('nosession')||SCENARIO.includes('forbidden'))){const status=SCENARIO.includes('forbidden')?403:401;return {ok:false,status,json:async()=>({ok:false,error:'TEST acceso'})};}
 if(nextError&&options.method==='POST'){nextError=false;return {ok:false,status:422,json:async()=>({ok:false,error:'Error de prueba API'})};}
 if(options.method&&options.method!=='GET')writes++;
 if(p==='/contexto') Object.assign(data,SCHEMA,{usuario:{nombre:'Vendedor TEST'},fecha:'12/11/2026',admin_responsables:true,vendedores:[{cod_vendedor:'246',tipo:'P'},{cod_vendedor:'120',tipo:'C'},{cod_vendedor:'311',tipo:'S'}],filtro_vendedores:[]});
 else if(p==='/catalogos'&&options.method==='GET')data.catalogos=catalogs[u.searchParams.get('tipo')].filter(row=>u.searchParams.get('todos')||row.activo);
 else if(p==='/catalogos'&&options.method==='POST'){const cat={id:40,tipo:body.tipo,codigo:'NUEVO_UI',puede_eliminar:1,...body};catalogs[body.tipo].push(cat);data.catalogo=cat;}
 else if(p.startsWith('/catalogos/')){const id=Number(p.split('/').pop());const list=Object.values(catalogs).find(rows=>rows.some(row=>row.id===id));const cat=list.find(row=>row.id===id);if(options.method==='DELETE')list.splice(list.indexOf(cat),1);else Object.assign(cat,body);data.catalogo=cat;}
 else if(p==='/fichas/buscar-rut')Object.assign(data,{existe_activa:!!lookupActive,solicitud:lookupActive,prospecto_completado:lookupOrigin});
 else if(p==='/resumen'){summaries++;data.resumen=[{estado:row.estado,total:1}];}
 else if(p==='/mis-solicitudes'||p==='/gestion'){listReads++;Object.assign(data,{solicitudes:gestion?[{...initial,id:99,estado:'COMPLETADA'},{...row}]:[{...row}],total:gestion?2:1});}
 else if(p.endsWith('/historial')){data.historial=[{accion:'CREADA',estado_nuevo:'BORRADOR',usuario_nombre:'TEST',creado_en:'2026-11-12',comentario:'<img src=x>',datos_evento:'{}'}];if(row.estado==='OBSERVADA')data.historial.push({accion:'OBSERVADA',estado_nuevo:'OBSERVADA',usuario_nombre:'Cobranza TEST',creado_en:'2026-11-12',comentario:'Corregir ficha TEST'});}
 else if(p==='/responsables'&&options.method==='GET')data.responsables=[responsible];
 else if(p.startsWith('/responsables')){savedResponsible=body;data.responsable=body;}
 else if(/^\/(prospectos|fichas)\/\d+$/.test(p)&&options.method==='GET')data.solicitud=sourceSnapshot&&p==='/prospectos/'+sourceSnapshot.id?{...sourceSnapshot}:{...row};
 else if(/^\/(prospectos|fichas)(\/\d+)?$/.test(p)&&options.method!=='GET'){if(p==='/fichas')row={...row,id:nextFichaId++,tipo:'FICHA',correlativo:null,ficha:{forma_pago:'CONTADO'},solicitud_origen_id:body.solicitud_origen_id||null,origen_correlativo:body.solicitud_origen_id?sourceSnapshot?.correlativo:null};row={...row,...body,estado:body.enviar?'PENDIENTE':'BORRADOR'};if(body.enviar&&!row.correlativo)row.correlativo='CLI-2026-'+String(++cliSequence).padStart(5,'0');data.solicitud={...row};}
 else if(/^\/(prospectos|fichas)\/\d+\/enviar$/.test(p)){row={...row,...body,estado:'PENDIENTE',correlativo:row.correlativo||(row.tipo==='FICHA'?'CLI-2026-'+String(++cliSequence).padStart(5,'0'):'PRO-2026-00001')};data.solicitud={...row};}
 else if(p.endsWith('/observar')){row.estado='OBSERVADA';data.solicitud={...row};}
 else if(p.endsWith('/revision')){row.estado='EN_REVISION';data.solicitud={...row};}
 else if(p.endsWith('/completar')){savedInternal=body.ficha_interna;row.estado='COMPLETADA';data.solicitud={...row};}
 else throw Error('Ruta no simulada '+p);
 return {ok:true,status:200,json:async()=>data};
};
JS;
$checks = <<<'JS'
(async()=>{
 let count=0;const assert=(ok,m)=>{if(!ok)throw Error(m);count++;};
 const wait=async f=>{for(let i=0;i<400;i++){if(f())return;await new Promise(r=>setTimeout(r,20));}throw Error('Tiempo agotado: '+row.tipo+' '+row.estado+'; modal '+$('feedbackTitle')?.textContent+' abierto='+$('feedbackDialog')?.open+'; inactivo='+idle()+'; cierres='+closeEvents+'; error='+document.body.dataset.testError+'; pruebas '+count);};
 const idle=()=>!$('pageNext').disabled;
 const modal=async(title)=>{await wait(()=>$('feedbackDialog')?.open);if(title)assert($('feedbackTitle').textContent===title,'Título: '+title);};
 const accept=async()=>{document.querySelector('#feedbackButtons .btn-primary-design').click();await wait(idle);};
 const submit=()=> $('prospectForm').dispatchEvent(new Event('submit',{cancelable:true,bubbles:true}));
 const openRow=async()=>{document.querySelector('[data-open="'+row.id+'"]').click();await wait(()=>idle()&&(gestion?$('detailDialog').open:$('businessName').value===row.razon_social));};
 let result;
 try{
 if(SCENARIO.includes('nosession')||SCENARIO.includes('forbidden')){
   await wait(()=>$('gateTitle').textContent!=='Validando sesión...');
   assert(document.body.classList.contains('module-locked'),'Contenido bloqueado');
   assert(getComputedStyle($('mainWrapper')).display==='none','Sin datos protegidos visibles');
   assert(!document.querySelector('dialog[open]'),'Sin modal protegido');assert(listReads===0,'No consulta listado sin acceso');
   if(SCENARIO.includes('forbidden'))assert($('gateTitle').textContent==='Sin acceso'&&$('gateLogin').hidden,'Sin acceso');
   else{
     assert($('gateTitle').textContent==='Debes iniciar sesión para continuar.','Aviso de sesión');
     const login=new URL($('gateLogin').href,location.href);
     assert($('gateLogin').getAttribute('href').startsWith('/src/modulo/varios/login/index.php?'),'Login existente');
     assert(login.searchParams.get('returnUrl')===location.pathname+location.search+location.hash,'Conserva URL original');
   }
 }else{
 await wait(()=>document.querySelector('[data-open]')&&idle());
 assert($('moduleGate').hidden&&!document.body.classList.contains('module-locked'),'Acceso validado');
 if(!gestion){
 assert($('sellerCode').options.length===3&&$('sellerCode').value==='246','Códigos vendedor');
 assert(!document.querySelector('.help-panel'),'Sin recuadro lateral');
 await openRow();assert(!$('businessName').disabled,'Borrador editable');assert(!$('requestHistory').querySelector('img'),'Historial escapa HTML');
 for(const [rut,expected] of [['141560646','14.156.064-6'],['14.156.064-6','14.156.064-6'],['1000005k','1.000.005-K']]){
   $('rut').value=rut;$('rut').dispatchEvent(new Event('blur'));
   assert($('rut').value===expected&&$('rutHelp').textContent==='RUT válido','Formato RUT '+rut);
 }
 for(const rut of ['141560645','141','14156x0646']){
   $('rut').value=rut;$('rut').dispatchEvent(new Event('blur'));
   assert($('btnDraft').disabled&&$('btnSend').disabled,'Bloquea RUT '+rut);
 }
 const beforeInvalid=writes;submit();await modal('RUT inválido');await accept();assert(writes===beforeInvalid,'Submit inválido no llama API');
 $('rut').value='141560646';$('rut').dispatchEvent(new Event('blur'));$('sellerCode').value='311';
 const beforeLists=listReads,beforeKpis=summaries;$('btnDraft').click();await modal('Borrador guardado correctamente');
 for(const id of ['rut','businessName','contactName','contactEmail','phone','products','observations'])assert($(id).value==='','Limpia '+id+' tras guardar');
 assert($('sellerName').value==='Vendedor TEST'&&$('sellerCode').value==='246','Mantiene vendedor y vuelve a Principal');
 assert(listReads>beforeLists&&summaries>beforeKpis,'Refresca listado y KPI al guardar');await accept();
 await openRow();$('btnSend').click();await modal('Solicitud enviada correctamente');
 assert($('feedbackText').textContent.includes('PRO-2026-00001'),'Muestra correlativo');
 for(const id of ['rut','businessName','contactName','contactEmail','phone','products','observations'])assert($(id).value==='','Limpia '+id+' tras enviar');
 assert($('sellerCode').value==='246','Principal tras enviar');await accept();
 await openRow();assert($('businessName').disabled&&$('btnSend').hidden,'Pendiente solo lectura');
 row.estado='COMPLETADA';await openRow();assert(!$('createFicha').hidden,'Crear Ficha disponible');
 sourceSnapshot={...row};const beforePreview=writes;
 $('createFicha').click();await wait(()=>!$('fichaSection').hidden&&idle());
 assert(writes===beforePreview&&row.tipo==='PROSPECTO','Precargar no crea registro ni correlativo');
 assert($('rut').readOnly,'RUT heredado fijo');assert($('businessName').value===sourceSnapshot.razon_social,'Precarga Ficha');
 const columns=getComputedStyle($('fichaIdentity')).gridTemplateColumns.split(' ').length;
 assert(columns===(innerWidth<=600?1:innerWidth<=1199?2:3),'Columnas responsive de Ficha');
 assert($('originBanner').textContent.includes(sourceSnapshot.correlativo)&&$('originAux').value==='AUX-TEST','Muestra origen y CodAux');
 assert($('f_encargado_compras').value===sourceSnapshot.contacto_nombre&&$('f_email_compras').value===sourceSnapshot.contacto_email,'Precarga contacto de compras');
 assert(!$('bankDetails').open,'Banco opcional colapsado');
 const fillFicha=()=>{for(const [key,spec] of Object.entries(SCHEMA.campos_ficha)){
   const el=$('f_'+key),format=spec[3];el.value=el.tagName==='SELECT'?el.options[1].value:Array.isArray(format)?format[0]:(format==='email'?'test@example.test':(format==='url'?'https://example.test':(spec[2]?'TEST':'')));
 }};
 assert($('f_origen_canal').tagName==='SELECT'&&$('f_origen_canal').options[1].text==='Web de prueba API','Opciones obtenidas de API');
 fillFicha();
 $('f_direccion_comercial').value='Av TEST 123';$('sameAddress').checked=true;$('sameAddress').dispatchEvent(new Event('change'));
 assert($('f_direccion_despacho').value==='Av TEST 123'&&$('f_direccion_despacho').readOnly,'Copia dirección comercial');
 $('f_direccion_comercial').value='Av TEST 456';$('f_direccion_comercial').dispatchEvent(new Event('input'));
 assert($('f_direccion_despacho').value==='Av TEST 456','Mantiene dirección de despacho sincronizada');
 $('sameAddress').checked=false;$('sameAddress').dispatchEvent(new Event('change'));assert(!$('f_direccion_despacho').readOnly,'Permite despacho distinto');
 $('f_rubro').value='OTROS';$('f_rubro').dispatchEvent(new Event('change'));assert($('f_rubro_otro').required,'Otro rubro obligatorio');$('f_rubro_otro').value='Textil';
 $('sellerCode').value='120';$('btnDraft').click();await modal('Borrador guardado correctamente');
 assert(row.tipo==='FICHA'&&row.solicitud_origen_id===sourceSnapshot.id&&row.correlativo===null,'Guarda Ficha vinculada sin correlativo');
 assert($('businessName').value===''&&$('originBanner').hidden&&$('sellerCode').value==='246','Limpia Ficha y origen tras guardar');await accept();
 assert($('myRequestsTitle').textContent==='Mis fichas de cliente'&&$('requestsBody').textContent.includes(sourceSnapshot.correlativo),'Listado de Fichas con origen');
 await openRow();$('btnSend').click();await modal('Solicitud enviada correctamente');assert(row.correlativo==='CLI-2026-00001','Envía Ficha');await accept();
 row.estado='OBSERVADA';await openRow();assert($('btnSend').textContent.includes('Reenviar')&&!$('businessName').disabled,'Ficha observada editable');
 assert(!$('fichaObservation').hidden&&$('fichaObservation').textContent.includes('Corregir ficha TEST'),'Muestra observación de Cobranza');
 $('f_giro').value='Giro corregido';$('btnSend').click();await modal('Solicitud enviada correctamente');assert(row.estado==='PENDIENTE'&&row.ficha.giro==='Giro corregido','Reenvía Ficha corregida');await accept();
 $('newRequest').click();assert(!$('rut').readOnly&&$('businessName').value==='','Ficha directa editable');
 lookupActive={id:row.id,correlativo:row.correlativo};$('rut').value=row.rut_original;$('rut').dispatchEvent(new Event('blur'));
 await modal('Ya existe una Ficha de Cliente activa para este RUT.');assert($('feedbackText').textContent.includes(row.correlativo),'Duplicado muestra correlativo');await accept();
 assert($('businessName').disabled,'Abre solicitud activa propia');lookupActive=null;
 $('newRequest').click();lookupOrigin={id:sourceSnapshot.id,correlativo:sourceSnapshot.correlativo};$('rut').value=sourceSnapshot.rut_original;$('rut').dispatchEvent(new Event('blur'));
 await modal('Existe un Prospecto completado para este cliente.');
 document.querySelector('#feedbackButtons .btn-secondary-design').click();await wait(idle);assert(!$('rut').readOnly&&$('originBanner').hidden,'Permite continuar desde cero');
 $('newRequest').click();$('rut').value=sourceSnapshot.rut_original;$('rut').dispatchEvent(new Event('blur'));
 await modal('Existe un Prospecto completado para este cliente.');await accept();assert($('rut').readOnly&&!$('originBanner').hidden,'Permite precargar desde Prospecto encontrado');
 lookupOrigin=null;$('newRequest').click();$('rut').value='11111111-1';$('rut').dispatchEvent(new Event('blur'));await wait(idle);
 $('businessName').value='Cliente directo TEST';fillFicha();$('btnSend').click();await modal('Solicitud enviada correctamente');
 assert(row.solicitud_origen_id===null&&row.correlativo==='CLI-2026-00002','Envía Ficha directa con CLI independiente');await accept();
 document.querySelector('[data-type="PROSPECTO"]').click();await wait(()=>$('fichaSection').hidden&&idle());assert($('f_giro').disabled,'Ficha no bloquea Prospecto');
 assert(document.documentElement.scrollWidth<=innerWidth,'Sin desborde horizontal del formulario');
 }else{
 assert(!$('responsablesSection').hidden,'Admin ve responsables');
 assert(document.querySelector('#requestsBody tr').classList.contains('state-pendiente'),'Pendiente prioritario');
 assert(getComputedStyle(document.querySelector('#requestsBody tr td')).fontWeight==='600','Pendiente destacado');
 await openRow();assert($('requestDetail').textContent.includes('<Cliente TEST>'),'Detalle seguro');
 const rect=$('detailDialog').getBoundingClientRect();
 assert(Math.abs(rect.left+rect.width/2-innerWidth/2)<10&&Math.abs(rect.top+rect.height/2-innerHeight/2)<10,'Modal centrado');
 assert(rect.width<=innerWidth&&rect.height<=innerHeight*.91,'Modal responsive');
 assert(document.documentElement.classList.contains('module-modal-open'),'Fondo bloqueado');
 $('btnObserve').click();await modal('Falta información');assert($('feedbackText').textContent==='Debes ingresar el motivo de la observación.','Motivo requerido');await accept();
 $('btnRevision').click();await modal('Iniciar revisión');assert($('feedbackText').textContent.includes('EN REVISIÓN'),'Confirma revisión');
 document.querySelector('#feedbackButtons .btn-secondary-design').click();await wait(idle);assert(row.estado==='PENDIENTE','Cancelar conserva estado');
 nextError=true;$('btnRevision').click();await modal('Iniciar revisión');document.querySelector('#feedbackButtons .btn-primary-design').click();await modal('No se pudo realizar la operación');assert($('feedbackText').textContent==='Error de prueba API','Error API visible');await accept();
 const beforeLists=listReads,beforeKpis=summaries;
 $('btnRevision').click();await modal('Iniciar revisión');document.querySelector('#feedbackButtons .btn-primary-design').click();await modal('Operación realizada correctamente');
 assert(row.estado==='EN_REVISION'&&$('btnRevision').hidden,'Estado y acciones de revisión');assert(listReads>beforeLists&&summaries>beforeKpis,'Refresca gestión y KPI');await accept();
 $('reviewComment').value='Corregir';$('btnObserve').click();await modal('Operación realizada correctamente');
 assert(row.estado==='OBSERVADA'&&$('btnObserve').hidden&&$('btnComplete').hidden,'Observada solo lectura');await accept();
 $('closeDetail').click();row={...initial,id:2,tipo:'FICHA',estado:'PENDIENTE',ficha:{cliente_clasificacion_interna:'Sin Clasificar'}};
 $('filterType').value='FICHA';$('filterForm').dispatchEvent(new Event('submit',{cancelable:true}));await wait(idle);await openRow();
 assert(!$('detailFicha').hidden&&!$('internalFields').hidden,'Detalle Ficha e internos');
 $('auxCode').value='';$('btnComplete').click();await modal('No se puede completar');assert($('feedbackText').textContent==='Debes ingresar el Código Auxiliar Softland.','Exige CodAux');await accept();
 $('auxCode').value='AUX-TEST';$('i_observacion_cobranza').value='Nota interna TEST';$('btnComplete').click();await modal('Completar solicitud');
 assert($('feedbackText').textContent.includes('AUX-TEST')&&row.estado==='PENDIENTE','Confirma CodAux antes de modificar');
 document.querySelector('#feedbackButtons .btn-primary-design').click();await modal('Operación realizada correctamente');
 assert(row.estado==='COMPLETADA'&&savedInternal.observacion_cobranza==='Nota interna TEST','Completa con internos');assert($('btnComplete').hidden&&$('btnObserve').hidden&&$('btnRevision').hidden,'Completada sin acciones');await accept();
 $('closeDetail').click();assert(!document.documentElement.classList.contains('module-modal-open'),'Restaura scroll al cerrar');
 document.querySelector('[data-responsable]').click();assert($('responsableName').value==='Responsable TEST','Editar responsable');
 $('recibe_correo').checked=false;$('responsableForm').dispatchEvent(new Event('submit',{cancelable:true}));await modal();assert(savedResponsible.recibe_correo===false,'Desactiva correo');await accept();
 document.querySelector('[data-config-tab="ORIGEN"]').click();await wait(()=>!$('catalogPanel').hidden&&$('catalogBody').querySelector('[data-cat-edit]')&&idle());
 assert($('responsablesPanel').hidden,'Pestañas de configuración');
 assert($('catalogBody').querySelector('[data-cat-delete="11"]').disabled&&$('catalogBody').textContent.includes('Puedes desactivarlo.'),'Uso impide eliminar');
 $('catalogName').value='Nuevo UI';$('catalogOrder').value='3';$('catalogForm').dispatchEvent(new Event('submit',{cancelable:true}));await wait(()=>$('catalogBody').querySelector('[data-cat-edit="40"]')&&idle());
 assert(catalogs.ORIGEN.some(row=>row.codigo==='NUEVO_UI'),'Crea catálogo');
 $('catalogBody').querySelector('[data-cat-edit="40"]').click();$('catalogName').value='Nombre editado';$('catalogOrder').value='4';$('catalogForm').dispatchEvent(new Event('submit',{cancelable:true}));await wait(()=>$('catalogBody').textContent.includes('Nombre editado')&&idle());
 assert(catalogs.ORIGEN.find(row=>row.id===40).codigo==='NUEVO_UI','Edita sin cambiar código');
 $('catalogBody').querySelector('[data-cat-toggle="40"]').click();await wait(()=>$('catalogBody').querySelector('[data-cat-toggle="40"]').textContent==='Activar'&&idle());
 $('catalogBody').querySelector('[data-cat-toggle="40"]').click();await wait(()=>$('catalogBody').querySelector('[data-cat-toggle="40"]').textContent==='Desactivar'&&idle());
 $('catalogBody').querySelector('[data-cat-delete="40"]').click();await modal('Eliminar valor de catálogo');await accept();assert(!catalogs.ORIGEN.some(row=>row.id===40),'Elimina no usado');
 for(const tab of ['RUBRO','FORMA_PAGO','RESPONSABLES']){document.querySelector('[data-config-tab="'+tab+'"]').click();await wait(idle);assert(tab==='RESPONSABLES'?!$('responsablesPanel').hidden:!$('catalogPanel').hidden,'Pestaña '+tab);}
 assert(document.documentElement.scrollWidth<=innerWidth,'Configuración sin desborde horizontal');
 }
 }
 result='OK '+SCENARIO+' '+count+' verificaciones';
 }catch(e){result='ERROR '+SCENARIO+' '+e.message;}
 const output=document.createElement('output');output.id='ui-result';output.textContent=result;document.body.append(output);
})();
JS;
$chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
if (!is_file($chrome)) { fwrite(STDERR,"Chrome local no disponible.\n"); exit(1); }
foreach (['ventas','cobranza','ventas-tablet','cobranza-tablet','ventas-mobile','cobranza-mobile','ventas-nosession','cobranza-nosession','cobranza-forbidden'] as $scenario) {
    $section = str_starts_with($scenario,'ventas') ? 'ventas' : 'cobranza';
    $mode = $section === 'ventas' ? 'ventas' : 'gestion';
    $html = file_get_contents($root . '/src/modulo/' . $section . '/clientes-prospectos/index.html');
    $html = preg_replace('#<script\b[^>]*>.*?</script>#s','',$html);
    $html = preg_replace('#<link\b[^>]*>#','',$html);
    $styles = file_get_contents($root . '/src/modulo/ventas/dashboard/dashboard.css') . file_get_contents($root . '/src/modulo/ventas/clientes-prospectos/clientes-prospectos.css');
    if ($section === 'cobranza') $styles .= preg_replace('/@import[^;]+;/','',file_get_contents($root . '/src/modulo/cobranza/clientes-prospectos/clientes-prospectos.css'));
    $injection = '<style>' . $styles . '</style><script>const SCENARIO=' . json_encode($scenario) . ';const SCHEMA=' . $schema . ';' . $mock . '</script><script>' . $shared . '</script><script>window.ClientesProspectos.init("' . $mode . '");' . $checks . '</script>';
    $path = $temp . '/' . $scenario . '.html';
    file_put_contents($path,str_replace('</body>',$injection . '</body>',$html));
    $pipes = [];
    $process = proc_open([$chrome,'--headless','--window-size=' . (str_contains($scenario,'mobile') ? '500,900' : (str_contains($scenario,'tablet') ? '900,900' : '1280,900')),'--disable-gpu','--disable-background-networking','--disable-extensions','--no-first-run',
        '--dump-dom','--virtual-time-budget=10000','--user-data-dir=' . $temp . '/profile-' . $scenario,'file:///' . str_replace('\\','/',$path) . '?solicitud=1'],
        [0=>['pipe','r'],1=>['pipe','w'],2=>['file',$temp . '/' . $scenario . '.log','w']],$pipes);
    if (!is_resource($process)) throw new RuntimeException('No se pudo iniciar Chrome.');
    fclose($pipes[0]);$output = stream_get_contents($pipes[1]);fclose($pipes[1]);proc_close($process);
    if (!preg_match('#<output id="ui-result">([^<]+)#',$output,$match)) throw new RuntimeException('Chrome no devolvió resultado. Log: ' . $temp);
    echo $match[1] . "\n";
    if (!str_starts_with($match[1],'OK ')) exit(1);
}
