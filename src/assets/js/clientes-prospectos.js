'use strict';
window.ClientesProspectos = (() => {
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const estados = ['BORRADOR','PENDIENTE','EN_REVISION','OBSERVADA','COMPLETADA','ANULADA','RECHAZADA'];
  const fields = {sellerCode:'codigo_vendedor',rut:'rut_original',businessName:'razon_social',contactName:'contacto_nombre',contactEmail:'contacto_email',phone:'telefono',products:'productos_interes',observations:'observacion_vendedor'};
  const labels = {correlativo:'N° solicitud',estado:'Estado',vendedor_nombre:'Vendedor',vendedor_email:'Email vendedor',codigo_vendedor:'Código vendedor',rut_original:'RUT',razon_social:'Razón social',contacto_nombre:'Nombre del contacto',contacto_email:'Correo del contacto',telefono:'Teléfono del contacto',productos_interes:'Productos o línea de interés',observacion_vendedor:'Observaciones',codigo_auxiliar_softland:'Código Auxiliar Softland',procesado_por_nombre:'Procesado por',creado_en:'Fecha',enviado_en:'Enviada',completado_en:'Completada'};
  let gestion, context, selected = null, page = 1, total = 0, busy = false, activeType = 'PROSPECTO', originDraft = null, checkedFichaRut = '';
  const fichaGroups = [
    ['IDENTIFICACIÓN DEL CLIENTE',['giro','nombre_fantasia','tipo_empresa','rubro','rubro_otro','origen_canal']],
    ['CONDICIONES COMERCIALES',['trabaja_con','forma_pago','tipo_precio','linea_productos']],
    ['DIRECCIONES',['direccion_comercial','ciudad','comuna','direccion_despacho']],
    ['CONTACTO DE COMPRAS',['encargado_compras','telefono_compras','email_compras']],
    ['FINANZAS / PAGOS',['contacto_finanzas','telefono_finanzas','email_finanzas']],
    ['DATOS GENERALES',['telefono_empresa','sitio_web']],
    ['DATOS BANCARIOS PARA DEVOLUCIONES',['banco_referencia','tipo_cuenta_referencia','numero_cuenta_referencia','titular_cuenta_referencia','rut_titular_cuenta_referencia','email_transferencia_referencia']],
  ];
  const catalogFields = {origen_canal:['ORIGEN','origen_codigo'],rubro:['RUBRO','rubro_codigo'],forma_pago:['FORMA_PAGO','forma_pago_codigo']};
  let catalogos = {};
  const optionLabel = value => ({'EMPRESA':'Empresa','P NATURAL':'Persona Natural','SOLO FACTURA':'Solo Factura','O/C FACTURA':'O/C Factura','OC Y GUIA':'OC y Guía','O/C GUIA Y HES':'O/C Guía y HES','Sin Clasificar':'Sin clasificar'})[value] || value;
  const request = window.fetch.bind(window);
  const label = state => String(state).replaceAll('_',' ');
  const requestStatus=row=>row.apelacion_en_tramite?'EN REVISIÓN · APELACIÓN':label(row.estado);
  const loginUrl = () => '/src/modulo/varios/login/index.php?returnUrl=' + encodeURIComponent(location.pathname + location.search + location.hash);
  const scrollLock = () => document.documentElement.classList.toggle('module-modal-open',!!document.querySelector('dialog[open]'));
  function feedback({type='success',title,message='',buttons=[{label:'Aceptar',value:true,primary:true}]}) {
    let dialog = $('feedbackDialog');
    if (!dialog) {
      dialog = document.createElement('dialog'); dialog.id='feedbackDialog'; dialog.className='feedback-dialog';
      dialog.setAttribute('aria-labelledby','feedbackTitle'); dialog.setAttribute('aria-describedby','feedbackText');
      dialog.innerHTML='<h2 id="feedbackTitle"></h2><p id="feedbackText"></p><div id="feedbackButtons" class="action-buttons"></div>';
      document.body.append(dialog);
    }
    $('feedbackTitle').textContent=title; $('feedbackText').textContent=message;
    dialog.dataset.type=type; $('feedbackButtons').replaceChildren();
    return new Promise(resolve=>{
      let settled=false;
      const finish=value=>{if(settled)return;settled=true;dialog.close(String(value));scrollLock();resolve(value);};
      dialog.oncancel=event=>{event.preventDefault();finish(false);};
      dialog.onclose=()=>{if(dialog.open)return;scrollLock();if(!settled){settled=true;resolve(false);}};
      buttons.forEach(spec=>{
        const button=document.createElement('button');button.type='button';button.textContent=spec.label;
        button.className=spec.primary?'btn-primary-design':'btn-secondary-design';
        button.onclick=()=>finish(spec.value===true);$('feedbackButtons').append(button);
      });
      dialog.returnValue='false'; dialog.showModal();scrollLock();
    });
  }
  const message = (text,error=false) => feedback({type:error?'error':'success',title:error?'No se pudo realizar la operación':'Operación realizada correctamente',message:text});
  function gate(status) {
    document.querySelectorAll('dialog[open]').forEach(dialog=>dialog.close());
    scrollLock();
    document.body.classList.add('module-locked');$('moduleGate').hidden=false;
    $('mainWrapper').hidden=true;$('sidebar').hidden=true;
    $('gateTitle').textContent=status===403?'Sin acceso':'Debes iniciar sesión para continuar.';
    $('gateText').textContent=status===403?'Tu usuario no tiene permiso para acceder a esta sección.':'';
    $('gateLogin').hidden=status===403;$('gateLogin').href=loginUrl();
    $('requestsBody').replaceChildren();$('requestHistory').replaceChildren();
    $('requestDetail')?.replaceChildren();$('detailFicha')?.replaceChildren();$('internalFields')?.replaceChildren();
    $('prospectForm')?.reset();selected=null;
  }
  function validRut(value) {
    const raw=String(value).trim().toUpperCase();
    if(!/^[0-9.]+-?[0-9K]$/.test(raw))return false;
    const rut=raw.replace(/[.-]/g,'');if(!/^[1-9][0-9]{0,7}[0-9K]$/.test(rut))return false;
    let sum=0,mul=2;
    for(let i=rut.length-2;i>=0;i--){sum+=Number(rut[i])*mul;mul=mul===7?2:mul+1;}
    const dv=11-sum%11;return rut.slice(-1)===(dv===11?'0':dv===10?'K':String(dv));
  }
  function formatRut(value) {
    const rut=String(value).trim().toUpperCase().replace(/[.-]/g,'');
    return /^[1-9][0-9]{0,7}[0-9K]$/.test(rut) ? rut.slice(0,-1).replace(/\B(?=(\d{3})+(?!\d))/g,'.')+'-'+rut.slice(-1) : String(value);
  }
  function updateRut(format=false) {
    if(!$('rut'))return true;
    const value=$('rut').value.trim(); const invalid=value!==''&&!validRut(value);
    if(format && value)$('rut').value=formatRut(value);
    $('rut').setCustomValidity(invalid?'El RUT ingresado no es válido.':'');
    $('rut').setAttribute('aria-invalid',String(invalid));$('rut').closest('.field').classList.toggle('is-error',invalid);
    $('rutHelp').textContent=invalid?'El RUT ingresado no es válido.':value?'RUT válido':'Ingresa el RUT con o sin puntos y guion.';
    $('rutHelp').classList.toggle('is-error',invalid);
    $('btnDraft').disabled=busy||invalid;$('btnSend').disabled=busy||invalid;
    return !invalid;
  }
  function loadInfrastructure() {
    // Carga los componentes existentes solo tras comprobar sesión y permiso en el servidor.
    window.TEXPRO_LOGIN_URL=new URL(loginUrl(),location.href).href;
    for(const placeholder of document.querySelectorAll('script[data-module-src]')){
      const script=document.createElement('script');script.src=placeholder.dataset.moduleSrc;script.async=false;document.body.append(script);
    }
  }
  async function api(path, method = 'GET', body) {
    const token = localStorage.getItem('token');
    const headers = {Accept:'application/json'};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body) headers['Content-Type'] = 'application/json';
    const res = await request('/api/clientes-prospectos' + path, {method,headers,credentials:'same-origin',body:body ? JSON.stringify(body) : undefined});
    if(res.status===401||(res.status===403&&path.startsWith('/contexto'))){gate(res.status);const error=new Error(res.status===403?'Sin acceso':'Debes iniciar sesión para continuar.');error.status=res.status;throw error;}
    let data;
    try { data = await res.json(); } catch (_) { throw new Error('Respuesta inválida del servidor. Revise que PHP esté activo.'); }
    if (!res.ok || !data.ok) throw new Error(data.error || 'No se pudo realizar la operación.');
    return data;
  }
  const scope = () => gestion ? '?ambito=gestion' : '';
  function renderFields(schema, prefix, values = {}, readonly = false) {
    return Object.entries(schema).map(([key,spec]) => {
      const [name,max,required,format] = spec;
      const value = values[key] ?? '';
      const attrs = `id="${prefix}${key}" maxlength="${max}" ${required ? 'required' : ''} ${readonly ? 'disabled' : ''}`;
      const catalog = prefix === 'f_' && catalogFields[key];
      let input;
      if (catalog) {
        const [tipo,codeField] = catalog;
        const code = values[codeField] || value;
        const rows = catalogos[tipo] || [];
        const match = rows.find(row=>row.codigo===code || (!values[codeField] && row.nombre===value));
        // Solo la selección histórica de esta ficha puede aparecer fuera de los activos.
        const historic = value && (!match || (values[codeField] && match.nombre!==value));
        const selectedCode = match?.codigo || code;
        input = `<select ${attrs}><option value="">Seleccione...</option>${historic?`<option value="${esc(selectedCode)}" selected>${esc(value)} (histórico)</option>`:''}${rows.filter(row=>!historic||row.codigo!==selectedCode).map(row=>`<option value="${esc(row.codigo)}" ${!historic&&row===match?'selected':''}>${esc(row.nombre)}</option>`).join('')}</select>`;
      } else input = Array.isArray(format) ? `<select ${attrs}><option value="">Seleccione...</option>${format.map(option=>`<option value="${esc(option)}" ${option===value?'selected':''}>${esc(optionLabel(option))}</option>`).join('')}</select>` : `<input ${attrs} type="${typeof format === 'string' ? format : 'text'}" value="${esc(value)}" />`;
      return `<div class="field"><label for="${prefix}${key}">${esc(name)}${required ? ' *' : ''}</label>${input}</div>`;
    }).join('');
  }
  function fichaForm(values = {}, readonly = false) {
    const identity = ['rut','businessName'].map(id=>$(id).closest('.field'));
    $('fichaFields').innerHTML = fichaGroups.map(([title,keys],index)=>{
      const fieldsHtml=renderFields(Object.fromEntries(keys.map(key=>[key,context.campos_ficha[key]])),'f_',values,readonly);
      const grid=`<div class="form-grid ficha-grid" ${index===0?'id="fichaIdentity"':''}>${fieldsHtml}</div>`;
      return index===6 ? `<details id="bankDetails" class="ficha-group"><summary>${title} · opcional</summary>${grid}</details>` : `<section class="ficha-group"><h4>${index+2}. ${title}</h4>${index===2?'<label class="same-address"><input id="sameAddress" type="checkbox" /> Usar misma dirección comercial para despacho</label>':''}${grid}</section>`;
    }).join('');
    (activeType==='FICHA' ? $('fichaIdentity') : $('prospectFields')).prepend(...identity);
    $('prospectData').hidden=activeType==='FICHA';
    $('prospectData').querySelectorAll('input,textarea').forEach(el=>{el.disabled=readonly || activeType==='FICHA';});
    identity.forEach(field=>field.querySelector('input').disabled=readonly);
    $('fichaSection').hidden = activeType !== 'FICHA';
    $('fichaFields').querySelectorAll('input,select').forEach(el=>{el.disabled=readonly || activeType !== 'FICHA';});
    const other = $('f_rubro_otro');
    const rubro = $('f_rubro');
    const update = () => { other.required = (rubro.value === 'OTROS' || rubro.value === 'Otros'); other.closest('.field').hidden = !other.required && !other.value; };
    rubro.onchange = update; update();
    const same=$('sameAddress'),commercial=$('f_direccion_comercial'),dispatch=$('f_direccion_despacho');
    same.disabled=readonly||activeType!=='FICHA';same.checked=!!commercial.value&&commercial.value===dispatch.value;
    const copy=()=>{if(same.checked)dispatch.value=commercial.value;dispatch.readOnly=readonly||same.checked;};
    same.onchange=copy;commercial.oninput=copy;copy();
    const bankRut=$('f_rut_titular_cuenta_referencia');
    const validateBank=()=>{const invalid=bankRut.value.trim()!==''&&!validRut(bankRut.value);bankRut.setCustomValidity(invalid?'El RUT del titular no es válido.':'');bankRut.closest('.field').classList.toggle('is-error',invalid);};
    bankRut.oninput=validateBank;bankRut.onblur=()=>{bankRut.value=formatRut(bankRut.value);validateBank();};
  }
  function readFicha(schema, prefix) { return Object.fromEntries(Object.keys(schema).map(key=>[key,$(prefix+key).value])); }
  function setType(tipo) {
    activeType = tipo;
    document.querySelectorAll('[data-type]').forEach(el=>el.classList.toggle('is-active',el.dataset.type===tipo));
    if (!gestion) {
      $('newRequest').textContent = tipo === 'FICHA' ? 'Nueva Ficha de Cliente' : 'Nuevo Prospecto';
      $('requestFormTitle').textContent = tipo === 'FICHA' ? 'Ficha Cliente' : 'Prospecto';
      $('requestDescription').textContent=tipo==='FICHA'?'Completa los antecedentes comerciales del cliente para revisión de Cobranza.':'Completa los antecedentes mínimos para solicitar la creación del auxiliar en Softland.';
      $('myRequestsTitle').textContent=tipo==='FICHA'?'Mis fichas de cliente':'Mis solicitudes';
      $('requestsHead').innerHTML=['Solicitud','Fecha','Cliente / RUT','CodV','Estado','Cot.','NV','Fact.','Vigencia','Acción'].map(name=>`<th${name==='CodV'?' title="Código vendedor" aria-label="Código vendedor"':''}>${name}</th>`).join('');
    }
  }
  async function run(task) {
    if (busy) return;
    busy = true;
    const buttons = [...document.querySelectorAll('main button, #detailDialog button')];
    const disabled = buttons.map(button => button.disabled);
    buttons.forEach(button => { button.disabled = true; });
    try { await task(); } catch (error) { if(error.status!==401&&error.status!==403)await message(error.message, true); }
    finally { busy = false; buttons.forEach((button,i) => { button.disabled = disabled[i]; }); updateRut(); }
  }
  function historyHtml(history) {
    if (!history.length) return '<p>Sin eventos.</p>';
    const names={...rejectionEvents,PRODIN_RUT_CONSULTADO:'RUT comprobado en PRODIN',CODAUX_DISTINTO_PROPUESTO:'CodAux confirmado diferente al propuesto',CREADA:'Solicitud creada',ENVIADA:'Solicitud enviada',REENVIADA:'Solicitud reenviada',BORRADOR_GUARDADO:'Borrador guardado',REVISION_INICIADA:'Revisión iniciada',OBSERVADA:'Solicitud observada',COMPLETADA:'Solicitud completada',FICHA_CREADA_DESDE_PROSPECTO:'Ficha creada desde Prospecto',FICHA_ENVIADA:'Ficha enviada',FICHA_BORRADOR_CREADA:'Borrador de Ficha creado',FICHA_BORRADOR_ACTUALIZADA:'Borrador de Ficha actualizado'};
    return history.map(event => `<article class="history-event"><strong>${esc(names[event.accion]||'Solicitud actualizada')} · ${esc(label(event.estado_nuevo))}</strong><p>${esc(event.creado_en)} · ${esc(event.usuario_nombre)}</p><p>${esc(event.estado_anterior ? label(event.estado_anterior) + ' → ' + label(event.estado_nuevo) : 'Solicitud creada')}</p><p>${esc(event.comentario)}</p>${gestion&&event.datos_evento ? `<details><summary>Datos del evento</summary><pre>${esc(JSON.stringify(JSON.parse(event.datos_evento), null, 2))}</pre></details>` : ''}</article>`).join('');
  }
  function labelCells(tbody) {
    const headers=[...tbody.closest('table').querySelectorAll('thead th')].map(th=>th.textContent);
    tbody.querySelectorAll('tr').forEach(tr=>{let index=0;[...tr.children].forEach(td=>{td.dataset.label=td.classList.contains('shared-cycle')?'Seguimiento compartido':headers[index]||'';index+=td.colSpan;});});
  }
  const canRelease=c=>['EN_GESTION','EXTENDIDO'].includes(c.estado);
  const canReassign=c=>['EN_GESTION','EXTENDIDO'].includes(c.estado);
  function rejectionMenu(row) {
    const actions=row.apelacion_en_tramite?[['aceptar-apelacion','Aceptar apelación'],['confirmar-rechazo','Confirmar rechazo']]:row.estado==='RECHAZADA'?[['reabrir','Reapertura administrativa']]:['PENDIENTE','EN_REVISION'].includes(row.estado)?[['rechazar','Rechazar solicitud']]:[];
    return actions.map(([action,name])=>`<button type="button" data-rejection-action="${action}" data-row="${row.id}">${name}</button>`).join('');
  }
  function validity(c) {
    if(!c)return '<span class="vigencia-pill is-neutral">—</span>';
    const days=c.dias_restantes;
    let text=cycleNames[c.estado]||'—',tone='neutral';
    if(['EN_GESTION','EXTENDIDO'].includes(c.estado)&&days!==null&&days!==undefined){
      text=(c.estado==='EXTENDIDO'?'Ext. ':'')+(days<0?`Vencido hace ${Math.abs(days)} días`:`${days} días`);
      tone=c.vigencia_nivel||'neutral';
    }else if(c.estado==='CONVERTIDO'){text='Convertido';tone='ok';}
    else if(c.estado==='EN_TRAMITE')text='Pendiente';
    else if(c.estado==='RESERVADO_BORRADOR')text='Reserva de borrador';
    return `<span class="vigencia-pill is-${['danger','warning','ok'].includes(tone)?tone:'neutral'}">${esc(text)}</span>`;
  }
  function commercialCells(row,primaryId) {
    const c=row.ciclo;
    if(c&&Number(primaryId)!==Number(row.id)){
      return `<td colspan="4" class="shared-cycle"><button type="button" class="btn-secondary-design" data-follow="${row.id}">Mismo ciclo ${esc(row.ciclo_origen_correlativo||row.origen_correlativo||'#'+c.solicitud_origen_id)}</button></td>`;
    }
    return [['cotizaciones','Cotizaciones','cotizaciones_count'],['notas-venta','Notas de Venta','notas_venta_count'],['facturas','Facturas','facturas_count']].map(([type,name,key])=>`<td><button type="button" class="document-count" data-row-doc="${type}" data-row="${row.id}" aria-label="${name}: ${Number(c?.[key]||0)}" ${!c||!Number(c[key])?'disabled':''}>${Number(c?.[key]||0)}</button></td>`).join('')+`<td>${validity(c)}</td>`;
  }
  async function refresh() {
    const query = new URLSearchParams({estado:$('filterState').value,buscar:$('filterSearch').value,pagina:page});
    const tipo = gestion ? $('filterType').value : activeType;
    if (tipo) query.set('tipo',tipo);
    if (gestion && $('filterSeller').value) query.set('vendedor',$('filterSeller').value);
    if ($('filterValidity').value) query.set('vigencia',$('filterValidity').value);
    if ($('filterOrder').value) query.set('orden',$('filterOrder').value);
    const [list,summary] = await Promise.all([api((gestion ? '/gestion?' : '/mis-solicitudes?') + query),api('/resumen?' + new URLSearchParams({ambito:gestion?'gestion':'ventas',tipo}))]);
    const lastPage=Math.max(1,Math.ceil(Number(list.total)/50));
    if(page>lastPage){page=lastPage;return refresh();}
    total = list.total;
    const counts = Object.fromEntries(summary.resumen.map(item => [item.estado,item.total]));
    document.querySelectorAll('[data-count]').forEach(el => { el.textContent = counts[el.dataset.count] || 0; });
    const rows=$('filterOrder').value?list.solicitudes:[...list.solicitudes].sort((a,b)=>Number(b.estado==='PENDIENTE')-Number(a.estado==='PENDIENTE'));
    const primaryCycles=new Map();
    rows.forEach(row=>{if(row.ciclo&&(!primaryCycles.has(row.ciclo.id)||Number(row.ciclo.solicitud_origen_id)===Number(row.id)))primaryCycles.set(row.ciclo.id,row.id);});
    $('requestsBody').innerHTML = rows.length ? rows.map(row => `<tr class="request-row state-${estados.includes(row.estado)?row.estado.toLowerCase():'borrador'}">
      <td>${esc(row.correlativo || 'Borrador #' + row.id)}<small class="request-kind">${row.tipo==='FICHA'?'Ficha Cliente':'Prospecto'}</small>${row.tipo==='FICHA'?`<small>${row.ciclo&&Number(row.ciclo.solicitud_origen_id)!==Number(row.id)?'Mismo ciclo':'Origen'}: ${esc(row.ciclo_origen_correlativo||row.origen_correlativo||'Directa')}</small>`:''}</td><td>${esc(row.creado_en)}</td>
      ${gestion ? `<td>${esc(row.vendedor_nombre)}<small class="request-kind">CodV ${esc(row.codigo_vendedor)}</small></td>` : ''}
      <td>${esc(row.razon_social || 'Sin razón social')}<small class="request-kind">${esc(row.rut_original)}</small></td>${gestion ? '' : `<td>${esc(row.codigo_vendedor)}</td>`}
      <td><span class="status-pill">${esc(requestStatus(row))}</span></td>${commercialCells(row,primaryCycles.get(row.ciclo?.id))}
      <td>${gestion?`<details class="request-actions"><summary>Acciones</summary><div><button type="button" data-open="${row.id}">Ver solicitud / seguimiento</button>${rejectionMenu(row)}${row.ciclo?`${canRelease(row.ciclo)&&row.estado==='COMPLETADA'?`<button type="button" data-row-action="liberar" data-row="${row.id}">Liberar cliente</button>`:''}${canReassign(row.ciclo)&&row.estado==='COMPLETADA'?`<button type="button" data-row-action="reasignar" data-row="${row.id}">Reasignar vendedor</button>`:''}`:''}</div></details>`:`<button type="button" class="btn-secondary-design" data-open="${row.id}">${['BORRADOR','OBSERVADA'].includes(row.estado) ? 'Editar' : 'Ver'}</button>`}</td></tr>`).join('') : '<tr><td colspan="10">No hay solicitudes para los filtros seleccionados.</td></tr>';
    $('requestsBody').querySelectorAll('[data-row-doc]').forEach(button=>button.onclick=()=>run(()=>{const row=rows.find(r=>Number(r.id)===Number(button.dataset.row));return openCycleDocs(row.ciclo,button.dataset.rowDoc);}));
    $('requestsBody').querySelectorAll('[data-follow]').forEach(button=>button.onclick=()=>run(()=>openRequest(button.dataset.follow)));
    $('requestsBody').querySelectorAll('[data-row-action]').forEach(button=>button.onclick=()=>run(()=>cycleAction(rows.find(r=>Number(r.id)===Number(button.dataset.row)).ciclo,button.dataset.rowAction)));
    $('requestsBody').querySelectorAll('[data-rejection-action]').forEach(button=>button.onclick=()=>run(()=>rejectionAction(rows.find(r=>Number(r.id)===Number(button.dataset.row)),button.dataset.rejectionAction)));
    $('pageInfo').textContent = `Página ${page} · ${total} solicitudes`;
    labelCells($('requestsBody'));
    $('pagePrevious').hidden = page <= 1;
    $('pageNext').hidden = page * 50 >= total;
  }
  function sellerOptions(code) {
    const select = $('sellerCode');
    select.innerHTML = context.vendedores.map(v => `<option value="${esc(v.cod_vendedor)}">${esc(v.cod_vendedor)} - ${esc(({P:'Principal',C:'Compartido',S:'Supervisor'})[v.tipo] || v.tipo)}</option>`).join('');
    if (code && !context.vendedores.some(v => String(v.cod_vendedor) === String(code))) select.add(new Option(code + ' - Ya no asociado',code));
    if (code) select.value = code;
    if (!select.options.length) select.add(new Option('Sin códigos asociados',''));
  }
  function showOrigin(row) {
    const hasOrigin=!!row?.solicitud_origen_id;
    $('originInfo').hidden=!hasOrigin;$('originBanner').hidden=!hasOrigin;
    $('originBanner').textContent=hasOrigin?'Ficha originada desde '+(row.origen_correlativo||'#'+row.solicitud_origen_id):'';
    $('originDisplay').value=row?.origen_correlativo||'';$('originAux').value=row?.codigo_auxiliar_softland||'';
  }
  async function activeFichaNotice(data) {
    const own=data.solicitud;
    const open=await feedback({type:'warning',title:'Ya existe una Ficha de Cliente activa para este RUT.',
      message:own?(own.correlativo||'Borrador #'+own.id):'La solicitud pertenece a otro vendedor. Contacta a Cobranza.',
      buttons:own?[{label:'Cancelar',value:false},{label:'Abrir solicitud',value:true,primary:true}]:[{label:'Aceptar',value:false,primary:true}]});
    if(open&&own)await openRequest(own.id);
  }
  async function previewFicha(source) {
    setType('FICHA');resetForm();originDraft=source;
    Object.entries(fields).forEach(([id,key])=>{$(id).value=source[key]||'';});
    const ownCode=context.vendedores.some(v=>String(v.cod_vendedor)===String(source.codigo_vendedor));
    sellerOptions(ownCode?source.codigo_vendedor:undefined);$('sellerName').value=source.vendedor_nombre;
    fichaForm({encargado_compras:source.contacto_nombre,email_compras:source.contacto_email,
      telefono_compras:source.telefono,telefono_empresa:source.telefono,linea_productos:source.productos_interes});
    $('rut').readOnly=true;
    showOrigin({solicitud_origen_id:source.id,origen_correlativo:source.correlativo,codigo_auxiliar_softland:source.codigo_auxiliar_softland});
    updateRut(true);checkedFichaRut=$('rut').value.replace(/[.-]/g,'').toUpperCase()+'#0';
    page=1;await refresh();$('prospectForm').scrollIntoView({behavior:'smooth',block:'start'});
  }
  async function checkFichaRut() {
    if(!$('rut').value.trim()||!validRut($('rut').value))return true;
    const key=$('rut').value.replace(/[.-]/g,'').toUpperCase()+'#'+(selected?.id||0);
    if(checkedFichaRut===key)return true;
    const reservation=await api('/validar-rut?'+new URLSearchParams({rut:$('rut').value}));
    const ownCycle=selected?.ciclo_comercial_id||originDraft?.ciclo_comercial_id;
    if(reservation.bloqueado&&!(reservation.propio&&ownCycle&&Number(ownCycle)===Number(reservation.ciclo_id))){
      const open=await feedback({type:'warning',title:reservation.mensaje,
        buttons:reservation.propio&&(reservation.solicitud||reservation.ciclo_id)?[{label:'Cancelar',value:false},{label:'Abrir solicitud / ciclo',value:true,primary:true}]:[{label:'Aceptar',value:false,primary:true}]});
      if(open&&reservation.solicitud)await openRequest(reservation.solicitud.id);
      else if(open&&reservation.ciclo_id)await openCycle(reservation.ciclo_id);
      return false;
    }
    if(activeType!=='FICHA'){checkedFichaRut=key;return true;}
    const data=await api('/fichas/buscar-rut?'+new URLSearchParams({rut:$('rut').value,excluir_id:selected?.id||0}));
    if(data.existe_activa){await activeFichaNotice(data);return false;}
    if(!selected&&!originDraft&&data.prospecto_completado){
      const use=await feedback({type:'confirm',title:'Existe un Prospecto completado para este cliente.',message:data.prospecto_completado.correlativo,
        buttons:[{label:'Continuar desde cero',value:false},{label:'Crear ficha desde Prospecto',value:true,primary:true}]});
      if(use){const detail=await api('/prospectos/'+data.prospecto_completado.id);await previewFicha(detail.solicitud);return false;}
    }
    checkedFichaRut=key;return true;
  }
  function resetForm() {
    selected = null;originDraft=null;checkedFichaRut='';
    $('prospectForm').reset();
    $('selectedCycle')?.remove();
    sellerOptions();
    $('sellerName').value = context.usuario.nombre;
    $('requestDate').value = new Intl.DateTimeFormat('es-CL',{timeZone:'America/Santiago'}).format(new Date());
    $('formStatus').textContent = 'Nuevo borrador';
    $('prospectForm').querySelectorAll('input,select,textarea,button').forEach(el => { el.disabled = false; });
    $('requestHistory').innerHTML = '';
    $('btnDraft').hidden = false;
    $('btnSend').hidden = false;
    $('btnSend').textContent = 'Enviar solicitud →';
    $('rut').readOnly = false;
    $('createFicha').hidden = true;
    showOrigin();$('fichaObservation').hidden=true;
    fichaForm();
    updateRut();
  }
  async function openRequest(id) {
    const detail = await api(`/prospectos/${id}` + scope());
    const request=detail.solicitud;
    if(!gestion&&request.ciclo&&!['BORRADOR','OBSERVADA'].includes(request.estado)){
      await openCycle(request.ciclo.id,request);return;
    }
    selected = request;originDraft=null;checkedFichaRut='';
    $('selectedCycle')?.remove();
    const history=await api(`/${id}/historial` + scope());
    if (gestion) {
      $('detailTitle').textContent = selected.correlativo || 'Borrador #' + selected.id;
      const section=(title,keys)=>`<section class="detail-section"><h4>${title}</h4><dl class="request-detail">${keys.map(key=>`<div><dt>${esc(labels[key])}</dt><dd>${esc(key==='rut_original'?formatRut(selected[key]):key==='correlativo'?(selected[key]||'Borrador #'+selected.id):selected[key]||'—')}</dd></div>`).join('')}</dl></section>`;
      $('requestDetail').innerHTML=section('SOLICITUD',['correlativo','estado','creado_en','vendedor_nombre','codigo_vendedor','vendedor_email'])+`<p>Tipo: ${selected.tipo==='FICHA'?'Ficha Cliente':'Prospecto'}</p>`+section(selected.tipo==='FICHA'?'CLIENTE':'PROSPECTO',['rut_original','razon_social','contacto_nombre','contacto_email','telefono','productos_interes','observacion_vendedor']);
      if(selected.tipo==='FICHA')$('requestDetail').insertAdjacentHTML('beforeend',`<p class="origin-note">Prospecto origen: ${esc(selected.origen_correlativo||'Directa')}</p>`);
      $('requestDetail').insertAdjacentHTML('beforeend',rejectionInfo(selected));
      wireRejection($('requestDetail'),selected);
      $('managementSummary').innerHTML=`<p>${selected.apelacion_en_tramite?'EN REVISIÓN · APELACIÓN':selected.estado==='OBSERVADA'?'En espera de corrección del vendedor.':selected.estado==='COMPLETADA'?'Solicitud completada · solo lectura.':''}</p>`+section('',['codigo_auxiliar_softland','procesado_por_nombre','completado_en']);
      $('requestCycle').hidden=!selected.ciclo;
      $('requestCycle').replaceChildren();
      if(selected.ciclo){
        $('cycleDialog')?.close();$('cycleDialog')?.querySelector('.cycle-dialog-body')?.replaceChildren();
        renderCycle(selected.ciclo,$('requestCycle'),selected);
      }
      $('detailFicha').hidden = selected.tipo !== 'FICHA';
      $('detailFicha').innerHTML = selected.tipo === 'FICHA' ? `<p class="origin-note">Origen: ${esc(selected.origen_correlativo || 'Directa')}</p>`+fichaGroups.map(([title,keys],index)=>{
        const identity=index===0?['rut_original','razon_social'].map(key=>`<div><dt>${esc(labels[key])}</dt><dd>${esc(key==='rut_original'?formatRut(selected[key]):selected[key])}</dd></div>`).join(''):'';
        const content=`<dl class="request-detail">${identity}${keys.map(key=>`<div><dt>${esc(context.campos_ficha[key][0])}</dt><dd>${esc((catalogFields[key] ? selected.ficha?.[key] || '—' : optionLabel(selected.ficha?.[key] || '—')))}</dd></div>`).join('')}</dl>`;
        return index===6?`<details class="detail-section"><summary>${title}</summary>${content}</details>`:`<section class="detail-section"><h4>${title}</h4>${content}</section>`;
      }).join('') : '';
      $('internalFields').hidden = selected.tipo !== 'FICHA';
      $('internalFields').innerHTML = selected.tipo === 'FICHA' ? renderFields(context.campos_internos,'i_',selected.ficha,!['PENDIENTE','EN_REVISION'].includes(selected.estado)) : '';
      $('requestHistory').innerHTML = historyHtml(history.historial);
      $('reviewComment').value = '';
      $('auxCode').value = selected.codigo_auxiliar_softland || '';
      $('auxSuggestion').textContent='';
      const proposal=selected.prodin_consulta;
      if(proposal?.seleccionado){if(!$('auxCode').value)$('auxCode').value=proposal.seleccionado;$('auxSuggestion').textContent='CodAux encontrado en PRODIN por RUT: '+proposal.seleccionado+'. Cobranzas debe confirmar.';}
      $('requestProdin').innerHTML='<button type="button" class="btn-secondary-design" data-prodin-rut>Comprobar actividad histórica PRODIN</button><div data-prodin-result></div>';
      $('requestProdin').querySelector('[data-prodin-rut]').onclick=()=>run(()=>checkProdinRut(selected));
      $('btnRevision').hidden = selected.estado !== 'PENDIENTE'||selected.apelacion_en_tramite;
      $('btnObserve').hidden = !['PENDIENTE','EN_REVISION'].includes(selected.estado)||selected.apelacion_en_tramite;
      $('btnComplete').hidden = $('btnObserve').hidden;
      $('processFields').hidden = $('btnObserve').hidden;
      $('btnReject').hidden=!['PENDIENTE','EN_REVISION'].includes(selected.estado)||selected.apelacion_en_tramite;
      $('btnAcceptAppeal').hidden=!selected.apelacion_en_tramite;$('btnConfirmReject').hidden=!selected.apelacion_en_tramite;
      $('btnReopen').hidden=selected.estado!=='RECHAZADA';
      if (!$('detailDialog').open) $('detailDialog').showModal();
      scrollLock();
    } else {
      const previousType = activeType;
      if(selected.ciclo){const banner=document.createElement('button');banner.id='selectedCycle';banner.type='button';banner.className='btn-secondary-design';banner.textContent=cycleStatus(selected.ciclo)+' · Ver vigencia';banner.onclick=()=>run(()=>openCycle(selected.ciclo.id));$('prospectForm').prepend(banner);}
      setType(selected.tipo);
      if (previousType !== activeType) { page=1; await refresh(); }
      sellerOptions(selected.codigo_vendedor);
      Object.entries(fields).forEach(([id,key]) => { $(id).value = selected[key] || ''; });
      $('sellerName').value = selected.vendedor_nombre;
      $('requestDate').value = selected.creado_en;
      $('formStatus').textContent = `${selected.correlativo || 'Borrador #' + selected.id} · ${label(selected.estado)}`;
      const readonly = !['BORRADOR','OBSERVADA'].includes(selected.estado);
      $('prospectForm').querySelectorAll('input,select,textarea').forEach(el => { el.disabled = readonly; });
      $('btnDraft').hidden = readonly;
      $('btnSend').hidden = readonly;
      $('btnSend').textContent = selected.estado === 'OBSERVADA' ? 'Reenviar solicitud →' : 'Enviar solicitud →';
      $('rut').readOnly = !!selected.solicitud_origen_id;
      $('createFicha').hidden = selected.tipo !== 'PROSPECTO' || selected.estado !== 'COMPLETADA';
      fichaForm(selected.ficha || {},readonly);
      showOrigin(selected);
      const observation=[...history.historial].reverse().find(event=>['OBSERVADA','OBSERVAR'].includes(event.accion));
      $('fichaObservation').hidden=selected.tipo!=='FICHA'||selected.estado!=='OBSERVADA';
      $('fichaObservation').textContent=observation?'Observación de Cobranza: '+observation.comentario:'';
      updateRut(true);
      $('requestHistory').innerHTML = `<h3>Historial ${esc(selected.codigo_auxiliar_softland ? '· Auxiliar Softland: ' + selected.codigo_auxiliar_softland : '')}</h3>` + historyHtml(history.historial);
      $('prospectForm').scrollIntoView({behavior:'smooth',block:'start'});
    }
  }
  async function save(send) {
    if(!updateRut(true)){await feedback({type:'warning',title:'RUT inválido',message:'El RUT ingresado no es válido.'});return;}
    if(!await checkFichaRut())return;
    if(send&&activeType==='FICHA'&&$('bankDetails').querySelector(':invalid'))$('bankDetails').open=true;
    if (send && !$('prospectForm').reportValidity()) return;
    const body = Object.fromEntries(Object.entries(fields).map(([id,key]) => [key,$(id).value]));
    const id = selected?.id;
    const resource = activeType === 'FICHA' ? '/fichas' : '/prospectos';
    if (activeType === 'FICHA') {
      body.ficha = readFicha(context.campos_ficha,'f_');
      if(originDraft)body.solicitud_origen_id=originDraft.id;
    }
    const path = id ? `${resource}/${id}${send ? '/enviar' : ''}` : resource;
    if (!id) body.enviar = send;
    const data = await api(path, id && !send ? 'PATCH' : 'POST',body);
    resetForm();
    await refresh();
    await feedback({title:send?'Solicitud enviada correctamente':'Borrador guardado correctamente',message:[data.solicitud.correlativo?`Solicitud: ${data.solicitud.correlativo}`:'',data.correo?.mensaje||''].filter(Boolean).join('\n')});
  }
  async function process(action) {
    const comment = $('reviewComment').value.trim();
    const code = $('auxCode').value.trim();
    if (action === 'observar' && !comment) {await feedback({type:'warning',title:'Falta información',message:'Debes ingresar el motivo de la observación.'});return;}
    if (action === 'completar' && !code) {await feedback({type:'warning',title:'No se puede completar',message:'Debes ingresar el Código Auxiliar Softland.'});return;}
    const proposal=selected.prodin_consulta;
    if(action==='completar'&&proposal?.auxiliares.length>1&&!proposal.seleccionado){await message('Seleccione un auxiliar de las coincidencias PRODIN antes de completar.',true);return;}
    const different=action==='completar'&&proposal?.seleccionado&&code!==proposal.seleccionado;
    if(action==='revision'||action==='completar'){
      const text=action==='revision'?`La solicitud ${selected.correlativo||'#'+selected.id} cambiará a EN REVISIÓN.`:`Se registrará el auxiliar ${code} y la solicitud quedará COMPLETADA.`+(different?` Atención: el CodAux ingresado (${code}) difiere del propuesto por RUT (${proposal.seleccionado}). Confirme esta excepción.`:'');
      if(!await feedback({type:'confirm',title:action==='revision'?'Iniciar revisión':'Completar solicitud',message:text,buttons:[{label:'Cancelar',value:false},{label:'Confirmar',value:true,primary:true}]}))return;
    }
    const body = {comentario:comment,codigo_auxiliar_softland:code};
    if(action==='completar'&&proposal){body.prodin_consulta_id=proposal.id_consulta;if(different)body.confirmar_codaux_diferente=true;}
    if (selected.tipo === 'FICHA' && action === 'completar') body.ficha_interna = readFicha(context.campos_internos,'i_');
    const data = await api(`/${selected.id}/${action}`,'POST',body);
    await refresh();
    await openRequest(selected.id);
    await message(`Solicitud ${label(data.solicitud.estado)}. ${data.correo?.mensaje || ''}`);
  }
  async function loadResponsables() {
    const data = await api('/responsables');
    $('responsablesBody').innerHTML = data.responsables.map(row => `<tr><td>${esc(row.nombre)}</td><td>${esc(row.email)}</td>${['recibe_prospecto','recibe_ficha','recibe_correo','activo'].map(key => `<td>${Number(row[key]) ? 'Sí' : 'No'}</td>`).join('')}<td><button type="button" class="btn-secondary-design" data-responsable="${row.id}">Editar</button></td></tr>`).join('');
    labelCells($('responsablesBody'));
    $('responsablesBody').onclick = event => {
      const id = event.target.closest('[data-responsable]')?.dataset.responsable;
      if (!id) return;
      const row = data.responsables.find(row => Number(row.id) === Number(id));
      $('responsableId').value = row.id;
      $('responsableName').value = row.nombre;
      $('responsableEmail').value = row.email;
      ['recibe_prospecto','recibe_ficha','recibe_correo','activo'].forEach(key => { $(key).checked = !!Number(row[key]); });
      $('responsableName').focus();
    };
  }
  let catalogType = 'ORIGEN';
  async function loadCatalogos() {
    const data = await api('/catalogos?' + new URLSearchParams({tipo:catalogType,todos:1}));
    $('catalogBody').innerHTML = data.catalogos.map(row=>`<tr><td>${esc(row.nombre)}</td><td>${esc(row.codigo)}</td><td>${esc(row.orden)}</td><td>${Number(row.activo)?'Activo':'Inactivo'}</td><td><div class="action-buttons"><button type="button" class="btn-secondary-design" data-cat-edit="${row.id}">Editar</button><button type="button" class="btn-secondary-design" data-cat-toggle="${row.id}">${Number(row.activo)?'Desactivar':'Activar'}</button><button type="button" class="btn-secondary-design" data-cat-delete="${row.id}" ${Number(row.puede_eliminar)?'':'disabled'}>Eliminar</button></div>${Number(row.puede_eliminar)?'':'<small>Este valor ya fue utilizado en solicitudes y no puede eliminarse. Puedes desactivarlo.</small>'}</td></tr>`).join('') || '<tr><td colspan="5">Sin valores.</td></tr>';
    labelCells($('catalogBody'));
    $('catalogBody').onclick = event=>{
      const button = event.target.closest('button');
      if (!button || button.disabled) return;
      const id = button.dataset.catEdit || button.dataset.catToggle || button.dataset.catDelete;
      const row = data.catalogos.find(row=>String(row.id)===id);
      if (!row) return;
      if (button.dataset.catEdit) {
        $('catalogId').value=id;$('catalogName').value=row.nombre;$('catalogOrder').value=row.orden;$('catalogActive').checked=!!Number(row.activo);$('catalogName').focus();
      } else run(async()=>{
        if (button.dataset.catDelete) {
          if (!await feedback({type:'confirm',title:'Eliminar valor de catálogo',message:row.nombre,buttons:[{label:'Cancelar',value:false},{label:'Eliminar',value:true,primary:true}]})) return;
          await api('/catalogos/'+id,'DELETE');
        } else await api('/catalogos/'+id,'PATCH',{activo:!Number(row.activo)});
        await loadCatalogos();
      });
    };
  }
  function initCatalogos() {
    document.querySelectorAll('[data-config-tab]').forEach(button=>button.onclick=()=>run(async()=>{
      const tab = button.dataset.configTab;
      document.querySelectorAll('[data-config-tab]').forEach(el=>{el.classList.toggle('is-active',el===button);el.setAttribute('aria-selected',String(el===button));});
      $('responsablesPanel').hidden=tab!=='RESPONSABLES';$('catalogPanel').hidden=tab==='RESPONSABLES';
      if (tab==='RESPONSABLES') return;
      catalogType=tab;$('catalogForm').reset();$('catalogId').value='';
      $('catalogName').maxLength=tab==='MOTIVO_RECHAZO'?120:context.campos_ficha[Object.keys(catalogFields).find(key=>catalogFields[key][0]===tab)][1];
      await loadCatalogos();
    }));
    $('newCatalog').onclick=()=>{$('catalogForm').reset();$('catalogId').value='';$('catalogName').focus();};
    $('catalogForm').onsubmit=event=>{
      event.preventDefault();run(async()=>{
        const id=$('catalogId').value;
        const body={nombre:$('catalogName').value,orden:$('catalogOrder').value,activo:$('catalogActive').checked};
        if (!id) body.tipo=catalogType;
        await api('/catalogos'+(id?'/'+id:''),id?'PATCH':'POST',body);
        $('catalogForm').reset();$('catalogId').value='';await loadCatalogos();
      });
    };
  }
  const cycleNames={RESERVADO_BORRADOR:'Reserva de borrador',EN_TRAMITE:'En trámite',EN_GESTION:'En gestión',EXTENDIDO:'Extendido',CONVERTIDO:'Convertido',LIBERADO:'Liberado',REASIGNADO:'Reasignado'};
  const cycleScope=()=>new URLSearchParams(gestion?{ambito:'gestion'}:{});
  const rejectionEvents={RECHAZADA:'Solicitud rechazada',APELACION_ENVIADA:'Apelación enviada',APELACION_ACEPTADA:'Apelación aceptada',APELACION_RECHAZADA:'Rechazo confirmado',RECHAZO_DEFINITIVO_POR_PLAZO:'Rechazo definitivo por vencimiento del plazo',REAPERTURA_ADMINISTRATIVA:'Reapertura administrativa',NUEVO_INGRESO_DESDE_RECHAZADA:'Nuevo ingreso desde solicitud rechazada'};
  function rejectionInfo(row) {
    if(!row?.rechazado_en)return '';
    const fields=[['Motivo',row.rechazo_motivo_texto],['Comentario Cobranzas',row.rechazo_comentario],['Fecha rechazo',row.rechazado_en],['Apelable hasta',row.apelable_hasta],['Días para apelar',row.apelacion_dias_restantes],['Fundamento apelación',row.apelacion_comentario],['Resultado apelación',row.apelacion_resultado?label(row.apelacion_resultado):null]];
    return `<section class="rejection-info"><h4>${row.estado==='RECHAZADA'?'SOLICITUD RECHAZADA':'ANTECEDENTES DEL RECHAZO'}</h4>${Number(row.rechazo_definitivo)?'<strong>Rechazo definitivo</strong>':''}<dl class="request-detail">${fields.filter(([,value])=>value!==null&&value!==undefined&&value!=='').map(([name,value])=>`<div><dt>${esc(name)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>${!gestion&&row.puede_apelar?'<button type="button" class="btn-primary-design" data-appeal>Apelar rechazo</button>':''}<details data-rejection-history><summary>Historial de rechazo / apelación</summary><div data-rejection-events></div></details></section>`;
  }
  function wireRejection(body,row) {
    const appeal=body.querySelector('[data-appeal]');if(appeal)appeal.onclick=()=>run(()=>rejectionAction(row,'apelar'));
    const history=body.querySelector('[data-rejection-history]');
    if(history)history.ontoggle=()=>{if(history.open)run(async()=>{const data=await api('/'+row.id+'/historial'+scope());body.querySelector('[data-rejection-events]').innerHTML=data.historial.filter(event=>rejectionEvents[event.accion]).map(event=>`<article class="cycle-history-event"><strong>${esc(rejectionEvents[event.accion])}</strong><span>${esc(event.creado_en)}</span>${gestion?`<span>${esc(event.usuario_nombre)}</span>`:''}<span>${esc(event.comentario||'')}</span></article>`).join('')||'<p>Sin eventos de rechazo.</p>';});};
  }
  async function rejectionAction(row,action) {
    const names={rechazar:'Rechazar solicitud',apelar:'Apelar rechazo','aceptar-apelacion':'Aceptar apelación','confirmar-rechazo':'Confirmar rechazo',reabrir:'Reapertura administrativa'};
    const reasons=action==='rechazar'?(await api('/catalogos?tipo=MOTIVO_RECHAZO')).catalogos:[];
    const body=cycleDialog('rejectionActionDialog',names[action]);
    body.innerHTML=`${action==='apelar'?`<p>Motivo original: ${esc(row.rechazo_motivo_texto)}</p><p>Comentario original: ${esc(row.rechazo_comentario)}</p>`:''}<form id="rejectionForm">${action==='rechazar'?`<div class="field"><label for="rejectionReason">Motivo de rechazo</label><select id="rejectionReason" required><option value="">Seleccione...</option>${reasons.map(reason=>`<option value="${esc(reason.codigo)}">${esc(reason.nombre)}</option>`).join('')}</select></div>`:''}<div class="field"><label for="rejectionComment">${action==='apelar'?'Fundamento de la apelación':'Comentario / motivo'}</label><textarea id="rejectionComment" maxlength="4000" ${['rechazar','apelar','reabrir'].includes(action)?'required':''}></textarea></div><button type="submit" class="btn-primary-design">${action==='apelar'?'Enviar apelación':'Confirmar'}</button></form>`;
    $('rejectionForm').onsubmit=event=>{event.preventDefault();run(async()=>{
      const payload={comentario:$('rejectionComment').value};if(action==='rechazar')payload.motivo_codigo=$('rejectionReason').value;
      const result=await api('/'+row.id+'/'+action,'POST',payload);$('rejectionActionDialog').close();scrollLock();await refresh();await openRequest(result.solicitud.id);
    });};
  }
  const historicalNames={cotizaciones:'Cotizaciones','notas-venta':'Notas de Venta',facturas:'Facturas'};
  const documentNames={cotizaciones:'Cotización','notas-venta':'Nota de Venta',facturas:'Factura'};
  const historicalBase=c=>c.solicitud_id?`/${c.solicitud_id}/historia-prodin`:`/ciclos/${c.id}/historia-prodin`;
  function historicalQuery(c) {const query=cycleScope();if(c.codigo_auxiliar)query.set('codigo_auxiliar',c.codigo_auxiliar);return query;}
  async function checkProdinRut(row,code=null) {
    const payload=code?{codigo_auxiliar:code}:{};
    const data=await api('/'+row.id+'/prodin-rut','POST',payload),lookup=data.consulta;
    row.prodin_consulta=lookup;
    const target=$('requestProdin').querySelector('[data-prodin-result]');
    if(!lookup.auxiliares.length){target.innerHTML='<p>No se encontró un cliente asociado a este RUT en PRODIN.</p>';$('auxSuggestion').textContent='';return;}
    const chosen=lookup.auxiliares.find(aux=>aux.codigo_auxiliar===lookup.seleccionado);
    if(chosen){
      if(!$('auxCode').value)$('auxCode').value=chosen.codigo_auxiliar;
      $('auxSuggestion').textContent='CodAux encontrado en PRODIN por RUT: '+chosen.codigo_auxiliar+'. Cobranzas debe confirmar.';
    }else $('auxSuggestion').textContent='Seleccione cuál auxiliar corresponde antes de completar.';
    target.innerHTML=`<div class="historical-notice"><strong>CLIENTE EXISTENTE EN PRODIN</strong>${lookup.auxiliares.length>1?'<p>Se encontraron varios códigos auxiliares asociados a este RUT.</p>':''}<div class="auxiliary-options">${lookup.auxiliares.map(aux=>`<article><strong>${esc(aux.codigo_auxiliar)} · ${esc(aux.nombre)}</strong><span>RUT ${esc(aux.rut)} · Activo ${esc(aux.activo||'—')} · Bloqueado ${esc(aux.bloqueado||'—')} · Cliente ${esc(aux.cliente||'—')}</span>${lookup.auxiliares.length>1?`<button type="button" class="btn-secondary-design" data-select-auxiliary="${esc(aux.codigo_auxiliar)}" aria-pressed="${aux.codigo_auxiliar===lookup.seleccionado}">${aux.codigo_auxiliar===lookup.seleccionado?'Seleccionado':'Seleccionar '+esc(aux.codigo_auxiliar)}</button>`:''}</article>`).join('')}</div><div data-prodin-summary></div></div>`;
    target.querySelectorAll('[data-select-auxiliary]').forEach(button=>button.onclick=()=>run(()=>checkProdinRut(row,button.dataset.selectAuxiliary)));
    if(chosen&&data.resumen_historico){
      const summary=data.resumen_historico,context={solicitud_id:row.id,codigo_auxiliar:chosen.codigo_auxiliar,nombre_prodin:chosen.nombre,...lookup,historical_counts:summary.cantidades};
      const summaryTarget=target.querySelector('[data-prodin-summary]');
      summaryTarget.innerHTML=`<p>${lookup.referencia_provisional?'Referencia provisional anterior a':'Historial anterior al inicio de gestión'} ${esc(lookup.referencia_historica)}${lookup.referencia_provisional?' · La gestión aún no comienza.':''}</p><dl class="request-detail">${Object.entries({ultima_cotizacion_historica_fecha:'Última cotización previa',ultima_nv_historica_fecha:'Última NV previa',ultima_factura_historica_fecha:'Última factura previa'}).filter(([key])=>summary.resumen[key]).map(([key,name])=>`<div><dt>${name}</dt><dd>${esc(summary.resumen[key])}</dd></div>`).join('')}</dl>${summary.tiene_actividad_historica?'':'<p>Sin actividad anterior a la referencia consultada.</p>'}<button type="button" class="btn-secondary-design" data-historical-list>Ver actividad histórica</button>`;
      summaryTarget.querySelector('[data-historical-list]').onclick=()=>run(()=>openHistorical(context));
    }
  }
  async function historicalSummary(c,body) {
    const data=await api(historicalBase(c)+'/resumen?'+historicalQuery(c));
    const target=body.querySelector('[data-historical-result]');
    target.innerHTML=data.tiene_actividad_historica?`<div class="historical-notice"><strong>CLIENTE EXISTENTE EN PRODIN</strong><p>Se detectó actividad comercial anterior al inicio de esta gestión.</p><dl class="request-detail">${Object.entries({ultima_cotizacion_historica_fecha:'Última cotización previa',ultima_nv_historica_fecha:'Última NV previa',ultima_factura_historica_fecha:'Última factura previa'}).filter(([key])=>data.resumen[key]).map(([key,name])=>`<div><dt>${name}</dt><dd>${esc(data.resumen[key])}</dd></div>`).join('')}</dl><button type="button" class="btn-secondary-design" data-historical-list>Ver actividad histórica</button></div>`:'<p>No se detectó actividad comercial anterior al inicio de esta gestión.</p>';
    const button=target.querySelector('[data-historical-list]');if(button)button.onclick=()=>run(()=>openHistorical({...c,historical_counts:data.cantidades}));
  }
  async function openHistorical(c,page=1,activeType=null) {
    if(!c.historical_counts){const summary=await api(historicalBase(c)+'/resumen?'+historicalQuery(c));c={...c,historical_counts:summary.cantidades};}
    const body=cycleDialog('historicalDocumentsDialog','Actividad histórica PRODIN');
    body.innerHTML=`${c.codigo_auxiliar?`<p>CodAux ${esc(c.codigo_auxiliar)} · ${esc(c.nombre_prodin||'')}</p>`:''}${c.referencia_historica?`<p>Documentos anteriores a ${esc(c.referencia_historica)}${c.referencia_provisional?' · Referencia provisional previa al inicio de gestión.':''}</p>`:''}`+Object.entries(historicalNames).map(([type,name])=>`<details class="historical-group" data-history-type="${type}"><summary>${name} (${Number(c.historical_counts?.[type]||0)})</summary><div data-history-body></div></details>`).join('');
    body.querySelectorAll('[data-history-type]').forEach(group=>{
      const type=group.dataset.historyType,container=group.querySelector('[data-history-body]');
      group.ontoggle=()=>{
        if(!group.open||container.dataset.loaded||container.dataset.loading)return;
        if(!Number(c.historical_counts?.[type])){container.textContent='Sin documentos históricos de este tipo.';container.dataset.loaded='1';return;}
        loadHistoricalGroup(c,type,type===activeType?page:1,container).catch(error=>{if(error.status!==401&&error.status!==403)message(error.message,true);});
      };
      if(type===activeType)group.open=true;
    });
  }
  async function loadHistoricalGroup(c,type,page,container) {
    if(container.dataset.loading)return;container.dataset.loading='1';
    container.querySelectorAll('button').forEach(button=>button.disabled=true);
    try{
      const query=historicalQuery(c);query.set('tipo',type);query.set('pagina',page);
      const data=await api(historicalBase(c)+'/documentos?'+query),docs=data.documentos.filter(doc=>doc.tipo===type);
      container.innerHTML=`<table class="historical-documents-table"><thead><tr>${['N°','Fecha','CodV','Vendedor','Estado','Monto','Ver'].map(name=>`<th scope="col">${name}</th>`).join('')}</tr></thead><tbody>`+docs.map((doc,index)=>`<tr class="historical-document"><td data-label="Documento"><span class="mobile-doc-kind">${documentNames[type]} N° </span>${esc(doc.numero)}</td><td data-label="Fecha">${esc(doc.fecha)}</td><td data-label="CodV">${esc(doc.vendedor)}</td><td data-label="Vendedor">${esc(doc.vendedor_nombre||'—')}</td><td data-label="Estado">${esc(doc.estado)}</td><td data-label="Monto">${esc(Number(doc.total||0).toLocaleString('es-CL'))}</td><td data-label="Ver"><button type="button" class="history-view" data-historical-document="${index}" title="Ver ${documentNames[type]}" aria-label="Ver ${documentNames[type]} N° ${esc(doc.numero)}"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="10" cy="10" r="6" fill="none" stroke="currentColor" stroke-width="2"/><path d="m15 15 6 6" fill="none" stroke="currentColor" stroke-width="2"/></svg><span class="mobile-view-label">Ver</span></button></td></tr>`).join('')+'</tbody></table>'+(!docs.length?'<p>Sin documentos históricos para esta página.</p>':'')+`<div class="pagination"><button type="button" class="btn-secondary-design" data-history-page="${page-1}" ${page<=1?'disabled':''}>Anterior</button><span>Página ${page}</span><button type="button" class="btn-secondary-design" data-history-page="${page+1}" ${data.hay_mas?'':'disabled'}>Siguiente</button></div>`;
      container.dataset.loaded='1';
      container.querySelectorAll('[data-historical-document]').forEach(button=>button.onclick=()=>run(()=>{const doc=docs[Number(button.dataset.historicalDocument)];return openCycleDocs(c,type,Number(doc.numero),true,page);}));
      container.querySelectorAll('[data-history-page]').forEach(button=>button.onclick=()=>{loadHistoricalGroup(c,type,Number(button.dataset.historyPage),container).catch(error=>message(error.message,true));});
    }finally{delete container.dataset.loading;}
  }
  function cycleStatus(c) {
    if(c.estado==='CONVERTIDO')return 'Convertido · Factura '+(c.factura_conversion_folio||'');
    if(['EN_GESTION','EXTENDIDO'].includes(c.estado))return (c.estado==='EXTENDIDO'?'Extensión · ':'')+'Vence en '+c.dias_restantes+' días';
    return cycleNames[c.estado]||c.estado;
  }
  function cycleDialog(id,title) {
    let dialog=$(id);
    if(!dialog){dialog=document.createElement('dialog');dialog.id=id;dialog.className='cycle-dialog';document.body.append(dialog);}
    dialog.innerHTML=`<header><h3>${esc(title)}</h3><button type="button" class="btn-secondary-design" data-close-cycle>Cerrar</button></header><div class="cycle-dialog-body"></div>`;
    dialog.querySelector('[data-close-cycle]').onclick=()=>{dialog.close();scrollLock();};
    dialog.oncancel=event=>{event.preventDefault();dialog.close();scrollLock();};dialog.onclose=scrollLock;
    if(!dialog.open)dialog.showModal();scrollLock();return dialog.querySelector('.cycle-dialog-body');
  }
  async function cycleAction(c,action) {
    const body=cycleDialog('cycleActionDialog',action==='liberar'?'Liberar cliente':'Reasignar vendedor');
    let vendors=[];
    if(action==='reasignar')vendors=(await api('/ciclos/vendedores?ambito=gestion')).vendedores;
    body.innerHTML=`<form id="cycleActionForm">${action==='reasignar'?`<div class="field"><label for="cycleDestination">Vendedor destino</label><select id="cycleDestination" required><option value="">Seleccione...</option>${vendors.filter(v=>Number(v.id)!==Number(c.usuario_vendedor_id)).map(v=>`<option value="${v.id}">${esc(v.nombre)} · ${esc(v.area)}</option>`).join('')}</select></div>`:''}<div class="field"><label for="cycleComment">Motivo / comentario obligatorio</label><textarea id="cycleComment" maxlength="4000" required></textarea></div><button type="submit" class="btn-primary-design">Confirmar</button></form>`;
    $('cycleActionForm').onsubmit=event=>{event.preventDefault();run(async()=>{
      const payload={comentario:$('cycleComment').value};if(action==='reasignar')payload.usuario_vendedor_id=Number($('cycleDestination').value);
      const data=await api(`/ciclos/${c.id}/${action}`,'POST',payload);
      $('cycleActionDialog').close();if($('cycleDialog')?.open)$('cycleDialog').close();scrollLock();await refresh();
      if(data.ciclo)await openCycle(data.ciclo.id);
    });};
  }
  async function openCycle(id,request=null) {
    const c=request?.ciclo||(await api('/ciclos/'+id+'?'+cycleScope())).ciclo;
    if(!request&&c.solicitud_origen_id)request=(await api('/prospectos/'+c.solicitud_origen_id+scope())).solicitud;
    if(gestion&&request){await openRequest(request.id);return;}
    const body=cycleDialog('cycleDialog','Seguimiento comercial · '+c.rut_original);
    renderCycle(c,body,request);
  }
  function renderCycle(c,body,request=null) {
    const id=c.id;
    const detail=entries=>`<dl class="request-detail">${entries.filter(([,value])=>value!==null&&value!==undefined&&String(value).trim()!=='').map(([name,value])=>`<div><dt>${esc(name)}</dt><dd>${esc(value??'—')}</dd></div>`).join('')}</dl>`;
    const client=!gestion&&request?'<h4>DATOS CLIENTE</h4>'+detail([['Solicitud',request.correlativo||'Borrador #'+request.id],['Tipo',request.tipo==='FICHA'?'Ficha Cliente':'Prospecto'],['Cliente',request.razon_social],['RUT',request.rut_original],['Estado solicitud',requestStatus(request)],['CodV',request.codigo_vendedor],['CodAux',c.codigo_auxiliar_softland]]):'';
    const active=['EN_GESTION','EXTENDIDO'].includes(c.estado);
    const fields=[['Estado',cycleNames[c.estado]],['Área',({QUIMICOS:'Químicos',TRAT_AGUA:'Tratamiento de aguas'})[c.tipo_area]],['Propietario',c.vendedor_nombre]];
    if(gestion)fields.push(['CodAux',c.codigo_auxiliar_softland]);
    if(c.estado==='RESERVADO_BORRADOR')fields.push(['Reserva de borrador hasta',c.reserva_hasta]);
    if(!['RESERVADO_BORRADOR','EN_TRAMITE'].includes(c.estado)&&c.inicio_gestion)fields.push(['Inicio gestión',c.inicio_gestion]);
    if(active){
      fields.push(['Vencimiento inicial',c.vence_inicial],['Días restantes',c.dias_restantes]);
      fields.push(['Extensión',Number(c.extension_usada)===1?'Activada':'No utilizada']);
      if(c.vence_extension)fields.push(['Vencimiento extensión',c.vence_extension]);
    }
    if(c.estado==='CONVERTIDO'&&c.factura_conversion_folio)fields.push(['Factura de conversión',c.factura_conversion_folio],['Fecha conversión',c.factura_conversion_fecha]);
    if(c.estado==='LIBERADO'){
      const reasons={LIBERACION_MANUAL:'Liberación por Cobranzas',BORRADOR_VENCIDO:'Reserva de borrador vencida',PLAZO_INICIAL_VENCIDO:'Plazo inicial vencido',PLAZO_EXTENSION_VENCIDO:'Plazo de extensión vencido'};
      fields.push(['Fecha liberación',c.liberado_en],['Motivo',reasons[c.liberado_motivo]||'Liberación registrada en historial'],['Comentario',c.liberado_comentario]);
    }
    fields.push(['Última sincronización',c.ultima_sincronizacion_softland||'Pendiente']);
    const status=active?validity(c):`<p class="cycle-status">${esc(cycleNames[c.estado]||'Seguimiento comercial')}</p>`;
    body.innerHTML=client+(!gestion?rejectionInfo(request):'')+`<h4>SEGUIMIENTO COMERCIAL</h4>${status}`+detail(fields)+`${c.estado==='REASIGNADO'?'<p>Reasignación registrada en Historial del ciclo.</p>':''}<div class="action-buttons">${!gestion&&c.puede_intentar_extension?`<button type="button" class="btn-primary-design" id="extendCycle">${c.extension_acreditada?'Extender gestión':'Validar actividad y extender'}</button>`:''}${!gestion&&request?.tipo==='PROSPECTO'&&request.estado==='COMPLETADA'?'<button type="button" class="btn-secondary-design" id="cycleCreateFicha">Crear Ficha de Cliente</button>':''}${gestion&&canRelease(c)&&(!request||request.estado==='COMPLETADA')?'<button type="button" class="btn-secondary-design" id="releaseCycle">Liberar cliente</button>':''}${gestion&&canReassign(c)&&(!request||request.estado==='COMPLETADA')?'<button type="button" class="btn-secondary-design" id="reassignCycle">Reasignar vendedor</button>':''}</div>${gestion&&!request&&c.codigo_auxiliar_softland&&c.inicio_gestion?'<section class="historical-section"><button type="button" class="btn-secondary-design" data-historical-summary>Comprobar actividad histórica PRODIN</button><div data-historical-result></div></section>':''}<details data-cycle-history><summary>Historial del ciclo</summary><div id="cycleHistory"></div></details>`;
    const extend=body.querySelector('#extendCycle'),release=body.querySelector('#releaseCycle'),reassign=body.querySelector('#reassignCycle'),create=body.querySelector('#cycleCreateFicha');
    if(request)wireRejection(body,request);
    const historical=body.querySelector('[data-historical-summary]');if(historical)historical.onclick=()=>run(()=>historicalSummary(c,body));
    if(extend)extend.onclick=()=>run(async()=>{await api('/ciclos/'+c.id+'/extender','POST',{});await refresh();if(request)await openRequest(request.id);else await openCycle(c.id);});
    if(release)release.onclick=()=>run(()=>cycleAction(c,'liberar'));
    if(reassign)reassign.onclick=()=>run(()=>cycleAction(c,'reasignar'));
    if(create)create.onclick=()=>{selected=request;$('cycleDialog').close();scrollLock();$('createFicha').hidden=false;$('createFicha').click();};
    body.querySelector('[data-cycle-history]').ontoggle=()=>{if(body.querySelector('[data-cycle-history]').open)run(async()=>{
      const history=await api('/ciclos/'+id+'/historial?'+cycleScope());
      body.querySelector('#cycleHistory').innerHTML=history.historial.map(h=>`<article class="cycle-history-event"><strong>${esc(h.etiqueta||'Seguimiento comercial actualizado')}</strong><span>${esc(h.creado_en)}</span>${h.resumen?`<span>${esc(h.resumen)}</span>`:''}${gestion?`<span>${esc(h.usuario_nombre||'Sistema')}</span><span>${esc(h.comentario||'')}</span>`:''}</article>`).join('')||'Sin eventos.';
    });};
  }
  async function openCycleDocs(c,type,number=null,historical=false,page=1) {
    const key=({'cotizaciones':'cotizaciones_count','notas-venta':'notas_venta_count','facturas':'facturas_count'})[type];
    if(number===null&&!Number(c[key]))return;
    const data=await api((historical?historicalBase(c):`/ciclos/${c.id}`)+`/${type}${number!==null?'/'+number:''}?`+(historical?historicalQuery(c):cycleScope()));
    const body=cycleDialog('cycleDocumentsDialog',(historical?'Histórico · ':'')+({cotizaciones:'Cotizaciones','notas-venta':'Notas de Venta',facturas:'Facturas'})[type]);
    if(number===null){
      body.innerHTML=data.documentos.map(doc=>`<article class="cycle-document"><strong>N° ${esc(doc.numero)}</strong><span>${esc(doc.fecha)} · Vendedor ${esc(doc.vendedor)} ${esc(doc.vendedor_nombre||'')}</span><span>Estado ${esc(doc.estado)} · Total ${esc(Number(doc.total).toLocaleString('es-CL'))}</span><button type="button" class="btn-secondary-design" data-document="${esc(doc.numero)}">Abrir documento</button></article>`).join('')||'<p>Sin documentos válidos para este ciclo.</p>';
      body.querySelectorAll('[data-document]').forEach(button=>button.onclick=()=>run(()=>openCycleDocs(c,type,Number(button.dataset.document))));
    }else{
      const money=value=>value===null||value===undefined?'—':Number(value).toLocaleString('es-CL');
      const columns=['Producto','Descripción','Cantidad','Unidad',type==='facturas'?'Precio neto unitario':'Precio','Descuento','Total línea'];
      body.innerHTML=`<button type="button" id="backCycleDocuments" class="btn-secondary-design">Volver al listado</button><p>N° ${esc(data.documento.numero)} · ${esc(data.documento.fecha)}</p><p>Subtotal: ${esc(money(data.documento.subtotal))} · Descuento: ${esc(money(data.documento.descuento))} · Neto: ${esc(money(data.documento.neto))} · Total: ${esc(money(data.documento.total))}</p><div class="document-lines"><table><thead><tr>${columns.map(name=>`<th scope="col">${esc(name)}</th>`).join('')}</tr></thead><tbody>`+data.lineas.map(line=>`<tr class="cycle-line">${[line.producto,line.descripcion,line.cantidad,line.unidad||'—',money(line.precio),money(line.descuento),money(line.total)].map((value,index)=>`<td data-label="${esc(columns[index])}">${esc(value)}</td>`).join('')}</tr>`).join('')+'</tbody></table></div>';
      $('backCycleDocuments').onclick=()=>run(()=>historical?openHistorical(c,page,type):openCycleDocs(c,type));
    }
  }
  async function init(mode) {
    gestion = mode === 'gestion';
    $('filterState').innerHTML = '<option value="">Todos los estados</option>' + estados.map(state => `<option value="${state}">${label(state)}</option>`).join('');
    $('requestsBody').onclick = event => {
      const id = event.target.closest('[data-open]')?.dataset.open;
      if (id) run(() => openRequest(id));
    };
    $('filterForm').onsubmit = event => { event.preventDefault(); page = 1; run(refresh); };
    $('btnRefresh').onclick=()=>run(async()=>{
      $('btnRefresh').textContent='↻ Actualizando...';$('refreshStatus').textContent='';
      try{await refresh();}catch(error){if(error.status===401||error.status===403)throw error;$('refreshStatus').textContent='No se pudo actualizar. Intente nuevamente.';}
      finally{$('btnRefresh').textContent='↻ Refrescar';}
    });
    $('pagePrevious').onclick = () => run(async () => { page = Math.max(1,page-1); await refresh(); });
    $('pageNext').onclick = () => run(async () => { if (page*50 < total) page++; await refresh(); });
    await run(async () => {
      context = await api('/contexto' + scope());
      $('moduleGate').hidden=true;$('mainWrapper').hidden=false;$('sidebar').hidden=false;document.body.classList.remove('module-locked');loadInfrastructure();
      if (gestion) {
        $('filterSeller').innerHTML = '<option value="">Todos los vendedores</option>' + context.filtro_vendedores.map(v => `<option value="${v.usuario_vendedor_id}">${esc(v.vendedor_nombre)}</option>`).join('');
        $('closeDetail').onclick = () => { $('detailDialog').close(); scrollLock(); };
        $('detailDialog').addEventListener('cancel',event=>{event.preventDefault();$('detailDialog').close();scrollLock();});
        $('detailDialog').addEventListener('close',scrollLock);
        $('btnRevision').onclick = () => run(() => process('revision'));
        $('btnObserve').onclick = () => run(() => process('observar'));
        $('btnComplete').onclick = () => run(() => process('completar'));
        for(const [id,action] of [['btnReject','rechazar'],['btnAcceptAppeal','aceptar-apelacion'],['btnConfirmReject','confirmar-rechazo'],['btnReopen','reabrir']])$(id).onclick=()=>run(()=>rejectionAction(selected,action));
        if (context.admin_responsables) {
          $('responsablesSection').hidden = false;
          initCatalogos();
          await loadResponsables();
          $('responsableForm').onsubmit = event => {
            event.preventDefault();
            run(async () => {
              const id = $('responsableId').value;
              const body = {nombre:$('responsableName').value,email:$('responsableEmail').value};
              ['recibe_prospecto','recibe_ficha','recibe_correo','activo'].forEach(key => { body[key] = $(key).checked; });
              await api('/responsables' + (id ? '/' + id : ''),id ? 'PATCH' : 'POST',body);
              $('responsableForm').reset(); $('responsableId').value = '';
              initCatalogos();
          await loadResponsables(); message('Responsable guardado.');
            });
          };
          $('newResponsable').onclick = () => { $('responsableForm').reset(); $('responsableId').value = ''; };
        }
      } else {
        await Promise.all(Object.values(catalogFields).map(async ([tipo])=>{catalogos[tipo]=(await api('/catalogos?tipo='+tipo)).catalogos;}));
        resetForm();
        $('rut').addEventListener('input',()=>{checkedFichaRut='';updateRut();});
        $('rut').addEventListener('blur',()=>{updateRut(true);if(!busy&&validRut($('rut').value))run(checkFichaRut);});
        document.querySelectorAll('[data-type]').forEach(el=>{el.onclick=()=>run(async()=>{setType(el.dataset.type);page=1;resetForm();await refresh();});});
        $('newRequest').onclick = resetForm;
        $('createFicha').onclick = () => run(async()=>{
          const source=selected;
          const existing=await api('/fichas/buscar-rut?'+new URLSearchParams({rut:source.rut_original}));
          if(existing.existe_activa){await activeFichaNotice(existing);return;}
          await previewFicha(source);
        });
        $('btnDraft').onclick = () => run(() => save(false));
        $('prospectForm').onsubmit = event => { event.preventDefault(); run(() => save(true)); };
      }
      await refresh();
      const cycleId=new URLSearchParams(location.search).get('ciclo');
      if(cycleId&&/^\d+$/.test(cycleId))await openCycle(cycleId);
      const id = new URLSearchParams(location.search).get('solicitud');
      if (id && /^\d+$/.test(id)) await openRequest(id);
      if (!gestion && !context.vendedores.length) message('Su usuario no tiene códigos vendedor asociados. Solicite su configuración a Administración.',true);
    });
  }
  return {init};
})();
