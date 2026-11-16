'use strict';
window.ClientesProspectos = (() => {
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const estados = ['BORRADOR','PENDIENTE','EN_REVISION','OBSERVADA','COMPLETADA','ANULADA'];
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
      $('requestsHead').innerHTML=(tipo==='FICHA'?['Solicitud','Fecha','Cliente','RUT','Código vendedor','Origen','Estado','Acción']:['Solicitud','Tipo','Fecha','Cliente','RUT','Cód. vendedor','Estado','Acción']).map(name=>`<th>${name}</th>`).join('');
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
    return history.map(event => `<article class="history-event"><strong>${esc(event.accion)} · ${esc(label(event.estado_nuevo))}</strong><p>${esc(event.creado_en)} · ${esc(event.usuario_nombre)}</p><p>${esc(event.estado_anterior ? label(event.estado_anterior) + ' → ' + label(event.estado_nuevo) : 'Solicitud creada')}</p><p>${esc(event.comentario)}</p>${event.datos_evento ? `<details><summary>Datos del evento</summary><pre>${esc(JSON.stringify(JSON.parse(event.datos_evento), null, 2))}</pre></details>` : ''}</article>`).join('');
  }
  function labelCells(tbody) {
    const headers=[...tbody.closest('table').querySelectorAll('thead th')].map(th=>th.textContent);
    tbody.querySelectorAll('tr').forEach(tr=>[...tr.children].forEach((td,index)=>{td.dataset.label=headers[index]||'';}));
  }
  async function refresh() {
    const query = new URLSearchParams({estado:$('filterState').value,buscar:$('filterSearch').value,pagina:page});
    const tipo = gestion ? $('filterType').value : activeType;
    if (tipo) query.set('tipo',tipo);
    if (gestion && $('filterSeller').value) query.set('vendedor',$('filterSeller').value);
    const [list,summary] = await Promise.all([api((gestion ? '/gestion?' : '/mis-solicitudes?') + query),api('/resumen?' + new URLSearchParams({ambito:gestion?'gestion':'ventas',tipo}))]);
    total = list.total;
    const counts = Object.fromEntries(summary.resumen.map(item => [item.estado,item.total]));
    document.querySelectorAll('[data-count]').forEach(el => { el.textContent = counts[el.dataset.count] || 0; });
    const rows=[...list.solicitudes].sort((a,b)=>Number(b.estado==='PENDIENTE')-Number(a.estado==='PENDIENTE'));
    $('requestsBody').innerHTML = rows.length ? rows.map(row => `<tr class="request-row state-${estados.includes(row.estado)?row.estado.toLowerCase():'borrador'}">
      <td>${esc(row.correlativo || 'Borrador #' + row.id)}${row.tipo==='FICHA'?'<small class="request-kind">Ficha Cliente</small>':''}</td>${!gestion&&activeType==='FICHA'?'':`<td>${row.tipo === 'FICHA' ? 'Ficha Cliente' : 'Prospecto'}</td>`}<td>${esc(row.creado_en)}</td>
      ${gestion ? `<td>${esc(row.vendedor_nombre)}</td><td>${esc(row.codigo_vendedor)}</td>` : ''}
      <td>${esc(row.razon_social || 'Sin razón social')}</td><td>${esc(row.rut_original)}</td>${gestion ? '' : `<td>${esc(row.codigo_vendedor)}</td>`}
      ${!gestion&&activeType==='FICHA'?`<td>${esc(row.origen_correlativo || 'Directa')}</td>`:''}
      <td><span class="status-pill">${esc(label(row.estado))}</span></td><td><button type="button" class="btn-secondary-design" data-open="${row.id}">${!gestion && ['BORRADOR','OBSERVADA'].includes(row.estado) ? 'Editar' : 'Ver'}</button></td></tr>`).join('') : `<tr><td colspan="${gestion?9:8}">No hay solicitudes para los filtros seleccionados.</td></tr>`;
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
    if(activeType!=='FICHA'||!$('rut').value.trim()||!validRut($('rut').value))return true;
    const key=$('rut').value.replace(/[.-]/g,'').toUpperCase()+'#'+(selected?.id||0);
    if(checkedFichaRut===key)return true;
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
    const [detail,history] = await Promise.all([api(`/prospectos/${id}` + scope()),api(`/${id}/historial` + scope())]);
    selected = detail.solicitud;originDraft=null;checkedFichaRut='';
    if (gestion) {
      $('detailTitle').textContent = selected.correlativo || 'Borrador #' + selected.id;
      const section=(title,keys)=>`<section class="detail-section"><h4>${title}</h4><dl class="request-detail">${keys.map(key=>`<div><dt>${esc(labels[key])}</dt><dd>${esc(key==='rut_original'?formatRut(selected[key]):key==='correlativo'?(selected[key]||'Borrador #'+selected.id):selected[key]||'—')}</dd></div>`).join('')}</dl></section>`;
      $('requestDetail').innerHTML=section('SOLICITUD',['correlativo','estado','creado_en','vendedor_nombre','codigo_vendedor','vendedor_email'])+section(selected.tipo==='FICHA'?'CLIENTE':'PROSPECTO',['rut_original','razon_social','contacto_nombre','contacto_email','telefono','productos_interes','observacion_vendedor']);
      if(selected.tipo==='FICHA')$('requestDetail').innerHTML=section('DATOS DE LA SOLICITUD',['correlativo','estado','creado_en','vendedor_nombre','codigo_vendedor','vendedor_email'])+`<p class="origin-note">Prospecto origen: ${esc(selected.origen_correlativo||'Directa')}</p>`;
      $('managementSummary').innerHTML=`<p>${selected.estado==='OBSERVADA'?'En espera de corrección del vendedor.':selected.estado==='COMPLETADA'?'Solicitud completada · solo lectura.':''}</p>`+section('',['codigo_auxiliar_softland','procesado_por_nombre','completado_en']);
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
      $('btnRevision').hidden = selected.estado !== 'PENDIENTE';
      $('btnObserve').hidden = !['PENDIENTE','EN_REVISION'].includes(selected.estado);
      $('btnComplete').hidden = $('btnObserve').hidden;
      $('processFields').hidden = $('btnObserve').hidden;
      if (!$('detailDialog').open) $('detailDialog').showModal();
      scrollLock();
    } else {
      const previousType = activeType;
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
    if(activeType==='FICHA'&&!await checkFichaRut())return;
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
    if(action==='revision'||action==='completar'){
      const text=action==='revision'?`La solicitud ${selected.correlativo||'#'+selected.id} cambiará a EN REVISIÓN.`:`Se registrará el auxiliar ${code} y la solicitud quedará COMPLETADA.`;
      if(!await feedback({type:'confirm',title:action==='revision'?'Iniciar revisión':'Completar solicitud',message:text,buttons:[{label:'Cancelar',value:false},{label:'Confirmar',value:true,primary:true}]}))return;
    }
    const body = {comentario:comment,codigo_auxiliar_softland:code};
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
      $('catalogName').maxLength=context.campos_ficha[Object.keys(catalogFields).find(key=>catalogFields[key][0]===tab)][1];
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
  async function init(mode) {
    gestion = mode === 'gestion';
    $('filterState').innerHTML = '<option value="">Todos los estados</option>' + estados.map(state => `<option value="${state}">${label(state)}</option>`).join('');
    $('requestsBody').onclick = event => {
      const id = event.target.closest('[data-open]')?.dataset.open;
      if (id) run(() => openRequest(id));
    };
    $('filterForm').onsubmit = event => { event.preventDefault(); page = 1; run(refresh); };
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
        $('rut').addEventListener('blur',()=>{updateRut(true);if(activeType==='FICHA'&&!busy&&validRut($('rut').value))run(checkFichaRut);});
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
      const id = new URLSearchParams(location.search).get('solicitud');
      if (id && /^\d+$/.test(id)) await openRequest(id);
      if (!gestion && !context.vendedores.length) message('Su usuario no tiene códigos vendedor asociados. Solicite su configuración a Administración.',true);
    });
  }
  return {init};
})();
