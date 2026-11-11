'use strict';
'use strict';

window.addEventListener('message', event => {
  if (event.data?.channel !== 'stockline') return;

  console.log('Stockline save response:', {
    origin: event.origin,
    requestId: event.data.requestId,
    ok: event.data.ok,
    error: event.data.error
  });
});
// Only public deployment URLs belong here. Never put credentials in this file.
const CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQR1Zz8Is-EkKOIFlsDCUGTqn1KjyPMpwiCf30WEK02ogDwzF5GWyZRAPxhdq2Q_PJTufapYdeGiZeU/pub?gid=701993598&single=true&output=csv';
const API_URL = 'https://script.google.com/macros/s/AKfycbx6ZUBrKNtxjsErhY8KQUugpDDJ-uP0U9-Lkms9TuAUP6xBcDW96cJKbVe_zeeNPSViXg/exec';
const $ = id => document.getElementById(id);
const state = {items: [], history: [], offset: 0, more: false, busy: false, live: false, loaded: false};
let mode, selected, returnFocus;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number = value => Number(value || 0);
const fmt = value => Number(value).toLocaleString();
function notify(message, error = false) {
  $('notice').textContent = message; $('notice').className = error ? 'error' : ''; $('notice').hidden = false;
}
function setBusy(value) {
  state.busy = value;
  document.querySelectorAll('button').forEach(b => b.disabled = value);
  $('save').textContent = value ? 'Saving…' : 'Save changes';
  if (!value) document.querySelectorAll('[data-action],#add').forEach(b => b.disabled = !state.live);
}
function checkConfig() {
  if (!API_URL.startsWith('https://script.google.com/macros/s/') || !API_URL.endsWith('/exec')) throw Error('Set API_URL in script.js to your deployed Apps Script /exec URL.');
  if (!CSV_URL.startsWith('https://')) throw Error('Set CSV_URL in script.js to your published Inventory CSV URL.');
}
// Reads use validated JSONP, avoiding Apps Script cross-origin fetch restrictions.
function readAPI(action, params = {}) {
  return new Promise((resolve, reject) => {
    const callback = 'stockline_' + crypto.randomUUID().replaceAll('-', '');
    const script = document.createElement('script');
    const timer = setTimeout(() => finish(Error('Live API timed out. Check deployment access and your connection.')), 30000);
    function finish(error, data) { clearTimeout(timer); script.remove(); delete window[callback]; error ? reject(error) : resolve(data); }
    window[callback] = response => response.ok ? finish(null, response.data) : finish(Error(response.error || 'API read failed.'));
    script.onerror = () => finish(Error('Could not read the live API. Check that deployment access is Anyone.'));
    const url = new URL(API_URL);
    Object.entries({action, callback, ...params, _:Date.now()}).forEach(([k,v]) => url.searchParams.set(k,v));
    script.src = url.href; document.head.append(script);
  });
}
// Writes use a real POST form, not no-cors fetch. The HTML response sends a
// correlated, origin-checked postMessage through the iframe to this page.
function writeAPI(payload) {
  return new Promise((resolve, reject) => {
    const frame = document.createElement('iframe');
    frame.name = 'write_' + payload.requestId.replaceAll('-', ''); frame.hidden = true;
    const form = document.createElement('form'); form.hidden = true; form.method = 'POST'; form.action = API_URL; form.target = frame.name;
    const body = document.createElement('input'); body.type = 'hidden'; body.name = 'payload';
    body.value = JSON.stringify({...payload, transport:'iframe', clientOrigin:location.origin}); form.append(body);
    let timer;
    function finish(error, data) { clearTimeout(timer); window.removeEventListener('message', receive); form.remove(); frame.remove(); error ? reject(error) : resolve(data); }
    function receive(event) {
  let origin;

  try {
    origin = new URL(event.origin);
  } catch {
    return;
  }

  const host = origin.hostname;

  const trustedGoogleHost =
    host === 'script.google.com' ||
    host === 'script.googleusercontent.com' ||
    host.endsWith('.script.googleusercontent.com') ||
    /^[a-z0-9-]+-script\.googleusercontent\.com$/.test(host);

  if (
    origin.protocol !== 'https:' ||
    origin.port !== '' ||
    !trustedGoogleHost
  ) {
    return;
  }

  const response = event.data;

  if (
    !response ||
    typeof response !== 'object' ||
    response.channel !== 'stockline' ||
    response.requestId !== payload.requestId ||
    typeof response.ok !== 'boolean'
  ) {
    return;
  }

  if (response.ok) {
    finish(null, response.data);
  } else {
    finish(new Error(response.error || 'Save failed.'));
  }
}
    window.addEventListener('message', receive);
    timer = setTimeout(() => finish(Error('Save confirmation timed out. The change may have been saved. Refresh before trying again.')),45000);
    document.body.append(frame,form); form.submit();
  });
}
// RFC 4180-style state machine: escaped quotes, embedded commas and newlines.
function parseCSV(text) {
  text = text.replace(/^\uFEFF/, '');
  const rows = []; let row = [], cell = '', quoted = false;
  for (let i=0; i<text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i+1] === '"') {cell += '"'; i++;} else quoted = !quoted;
    } else if (c === ',' && !quoted) {row.push(cell); cell = '';}
    else if ((c === '\r' || c === '\n') && !quoted) {
      if (c === '\r' && text[i+1] === '\n') i++;
      row.push(cell); if (row.some(v => v !== '')) rows.push(row); row=[];cell='';
    } else cell += c;
  }
  if (quoted) throw Error('Published CSV contains an unclosed quote.');
  if (cell || row.length) {row.push(cell); rows.push(row);}
  if (!rows.length) throw Error('The CSV is empty. Publish the Inventory tab with its headers.');
  const headers = rows.shift().map(s => s.trim());
  const required = ['ID','Name','SKU','HomeQty','TruckQty','ReorderLevel','Notes','Active','CreatedAt','UpdatedAt'];
  if (required.some((v,i) => headers[i] !== v)) throw Error('CSV headers do not match the Inventory schema. Check the published tab.');
  return rows.filter(r => r[0]).map(r => {
    const item = Object.fromEntries(headers.map((h,i) => [h,r[i] ?? '']));
    ['HomeQty','TruckQty','ReorderLevel'].forEach(k => {
      item[k] = number(item[k]);
      if (!Number.isSafeInteger(item[k]) || item[k]<0) throw Error('Invalid numeric quantity in the published CSV.');
    });
    item.Active = String(item.Active).toLowerCase() === 'true'; return item;
  });
}
async function load() {
  if (state.busy) return;
  setBusy(true); $('products').setAttribute('aria-busy','true');
  $('syncStatus').textContent = 'Refreshing inventory…';
  try {
    checkConfig();
    let csvWarning = '';
    // CSV is a first-load preview only. Never replace live state with cached CSV.
    if (!state.loaded) {
      try {
        const url = new URL(CSV_URL); url.searchParams.set('_',Date.now());
        const response = await fetch(url, {cache:'no-store', signal:AbortSignal.timeout(20000)});
        if (!response.ok) throw Error('HTTP ' + response.status);
        state.items = parseCSV(await response.text()).filter(p => p.Active);
        state.loaded = true; render();
        $('syncStatus').textContent = 'Published CSV loaded · verifying live quantities…';
      } catch (e) {csvWarning = 'CSV unavailable (' + e.message + '). Showing live API data instead.';}
    }
    const data = await readAPI('getInventory'); state.items = data.items;
    state.live = true; state.loaded = true; render();
    $('syncStatus').textContent = 'Live inventory · updated ' + new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
    if (csvWarning) notify(csvWarning, true);
  } catch (e) {
    state.live = false; notify(e.message,true);
    $('syncStatus').textContent = state.loaded ? 'Cached view only · editing disabled until live connection returns' : 'Unable to load inventory';
    if (!state.loaded) $('products').innerHTML = '<p class="empty">Configure your URLs, check deployment access, then refresh.</p>';
  } finally {setBusy(false); $('products').setAttribute('aria-busy','false');}
}
function status(p) {const total=p.HomeQty+p.TruckQty; return total===0 ? ['out','Out of stock'] : total<=p.ReorderLevel ? ['low','Low stock'] : ['good','In stock'];}
function render() {
  const items = state.items;
  $('home').textContent = fmt(items.reduce((s,p)=>s+p.HomeQty,0));
  $('car').textContent = fmt(items.reduce((s,p)=>s+p.TruckQty,0));
  $('total').textContent = fmt(items.reduce((s,p)=>s+p.HomeQty+p.TruckQty,0));
  $('low').textContent = fmt(items.filter(p=>p.HomeQty+p.TruckQty<=p.ReorderLevel).length);
  const q=$('search').value.trim().toLowerCase(), f=$('filter').value;
  const visible=items.filter(p=>[p.Name,p.PartNumber,p.SKU,p.Notes].join(' ').toLowerCase().includes(q)).filter(p=>f==='all'||f==='home'&&p.HomeQty>0||f==='car'&&p.TruckQty>0||f==='low'&&p.HomeQty+p.TruckQty<=p.ReorderLevel||f==='out'&&p.HomeQty+p.TruckQty===0);
  $('count').textContent = '('+visible.length+')';
  $('products').innerHTML = visible.map(p=>{
    const [cls,label]=status(p);
    return `<article class="product"><div><h3>
  <button
    type="button"
    class="item-stock-button"
    data-stock-id="${esc(p.ID)}"
    aria-label="Add or remove inventory for ${esc(p.Name)}"
  >${esc(p.Name)}</button>
</h3>
<p class="muted">${esc(p.PartNumber || 'No part number')}</p>${p.Notes ? `<p class="muted">${esc(p.Notes)}</p>`:''}</div><div class="quantities"><div><span>HOME</span><b>${fmt(p.HomeQty)}</b></div><div><span>CAR</span><b>${fmt(p.TruckQty)}</b></div><div><span>TOTAL</span><b>${fmt(p.HomeQty+p.TruckQty)}</b></div></div><span class="badge ${cls}">${label}</span><div class="actions">${[['transfer','Move'],['adjust','Adjust'],['editItem','Edit']].map(([a,l])=>`<button class="secondary" data-action="${a}" data-id="${esc(p.ID)}" aria-label="${l} ${esc(p.Name)}" ${!state.live||state.busy?'disabled':''}>${l}</button>`).join('')}</div></article>`;
  }).join('') || `<p class="empty">${items.length ? 'No products match your search or filter.' : 'Your inventory is empty. Add your first item to get started.'}</p>`;
}
function input(label,name,value='',type='text',required=false) {
  return `<label>${label}<input name="${name}" type="${type}" value="${esc(value)}" ${required?'required':''} ${type==='number'?'min="0" max="1000000000" step="1" inputmode="numeric"': 'maxlength="'+(name==='Name'?160:80)+'"'}></label>`;
}
function notes(label,name,value='') {return `<label>${label}<textarea name="${name}" maxlength="2000">${esc(value)}</textarea></label>`;}
function locations(name, value) {return `<label>${name==='from'?'From location':name==='to'?'To location':'Location'}<select name="${name}"><option value="Home" ${value==='Home'?'selected':''}>Home / Storage</option><option value="Truck" ${value==='Truck'?'selected':''}>Truck</option></select></label>`;}
function openEditor(action,id) {
  if (!state.live || state.busy) return;
  mode=action; selected=state.items.find(p=>p.ID===id); returnFocus=document.activeElement;
  $('formError').textContent=''; $('archive').hidden=action!=='editItem';
  $('dialogTitle').textContent={addItem:'Add inventory item',editItem:'Edit product',transfer:'Move stock',adjust:'Adjust actual count'}[action];
  const p=selected || {Name:'',SKU:'',Notes:'',ReorderLevel:0,HomeQty:0,TruckQty:0};
  let html = selected ? `<div class="context"><strong>${esc(p.Name)}</strong><br>Home: ${fmt(p.HomeQty)} · Truck: ${fmt(p.TruckQty)}</div>` : '';
  if (action==='addItem'||action==='editItem') {
    html+=input('Product name *','Name',p.Name,'text',true)+input('SKU / item code','SKU',p.SKU)+notes('Description / notes','Notes',p.Notes)+input('Reorder level','ReorderLevel',p.ReorderLevel,'number',true);
    if(action==='addItem') html+='<div class="pair">'+input('Starting at home','HomeQty',0,'number',true)+input('Starting in car','TruckQty',0,'number',true)+'</div>';
  } else if(action==='transfer') {
    const from=p.HomeQty>0?'Home':'Truck';
    html+='<div class="pair">'+locations('from',from)+locations('to',from==='Home'?'Truck':'Home')+'</div>'+input('Quantity to move *','quantity',1,'number',true)+notes('Optional note','note');
  } else html+=locations('location','Truck')+input('New actual quantity *','quantity',p.TruckQty,'number',true)+notes('Reason (optional)','note');
  $('fields').innerHTML=html;
  if(action==='transfer') $('fields').querySelector('[name=quantity]').min='1';
  $('editor').showModal(); $('fields').querySelector('input,select,textarea')?.focus();
}
function closeEditor() {if(state.busy)return; $('editor').close(); returnFocus?.focus();}
$('fields').addEventListener('change', e => {
  const changed = e.target;

  if (mode === 'transfer') {
    const from = $('fields').querySelector('select[name="from"]');
    const to = $('fields').querySelector('select[name="to"]');

    if (!from || !to) return;

    if (changed === from) {
      to.value = from.value === 'Home' ? 'Truck' : 'Home';
    } else if (changed === to) {
      from.value = to.value === 'Home' ? 'Truck' : 'Home';
    }
  }

  // Preserve the existing Adjust dialog behavior.
  if (
    mode === 'adjust' &&
    changed.name === 'location' &&
    selected
  ) {
    const quantityInput =
      $('fields').querySelector('[name="quantity"]');

    if (quantityInput) {
      quantityInput.value =
        selected[changed.value === 'Home' ? 'HomeQty' : 'TruckQty'];
    }
  }
});
async function commit(payload) {
  setBusy(true); $('formError').textContent='';
  try {
    // A new ID for each deliberate submission; the server deduplicates that ID.
    const saved = await writeAPI({...payload,requestId:crypto.randomUUID()});
    if (saved.item) {
      state.items = state.items.filter(p => p.ID !== saved.item.ID);
      if (saved.item.Active) state.items.push(saved.item);
      render();
    }
    $('editor').close(); $('confirmation').close();
    notify('Saved successfully.'); state.history=[];state.offset=0;
    setBusy(false); await load();
    if (!$('historyView').hidden) await loadHistory(true);
    returnFocus?.focus();
  } catch(e) { $('formError').textContent=e.message; notify(e.message,true); }
  finally {setBusy(false);}
}
$('editorForm').addEventListener('submit',e=>{
  e.preventDefault(); if(state.busy)return;
  const values=Object.fromEntries(new FormData(e.currentTarget));
  try {
    Object.keys(values).filter(k=>['ReorderLevel','HomeQty','TruckQty','quantity'].includes(k)).forEach(k=>{
      if(!/^\d+$/.test(values[k]) || !Number.isSafeInteger(Number(values[k])) || Number(values[k])>1000000000) throw Error('Quantities must be whole numbers from 0 to 1,000,000,000.');
      values[k]=Number(values[k]);
    });
    if ('Name' in values) {
      values.Name=values.Name.trim(); values.SKU=values.SKU.trim();
      if(!values.Name)throw Error('Enter a product name.');
      if(values.SKU&&state.items.some(p=>p.ID!==selected?.ID&&p.SKU.toLowerCase()===values.SKU.toLowerCase())) throw Error('That SKU is already in use.');
    }
    if(mode==='transfer') {
      if(values.from===values.to)throw Error('Choose two different locations.');
      if(values.quantity<=0)throw Error('Move at least one unit.');
      if(values.quantity>selected[values.from==='Home'?'HomeQty':'TruckQty'])throw Error('Not enough stock at the source location.');
    }
    commit({action:mode,...values,...(selected ? {id:selected.ID,expectedUpdatedAt:selected.UpdatedAt}: {})});
  } catch(e) {$('formError').textContent=e.message;}
});
$('archive').onclick=()=>{ $('confirmText').textContent='Archive “'+selected.Name+'”?'; $('confirmation').showModal(); };
$('confirmCancel').onclick=()=> $('confirmation').close();
$('confirmArchive').onclick=()=>commit({action:'archiveItem',id:selected.ID,expectedUpdatedAt:selected.UpdatedAt});
['editor','confirmation'].forEach(id=>$(id).addEventListener('cancel',e=>{if(state.busy)e.preventDefault();}));
$('closeDialog').onclick=closeEditor; $('cancel').onclick=closeEditor;
$('add').onclick=()=>openEditor('addItem');
$('products').addEventListener('click',e=>{const b=e.target.closest('[data-action]');if(b)openEditor(b.dataset.action,b.dataset.id);});
$('search').oninput=render; $('filter').onchange=render; $('refresh').onclick=load;
function renderHistory() {
  const q=$('historySearch').value.trim().toLowerCase();
  const tx=state.history.filter(t=>(t.ProductName+' '+t.ProductID).toLowerCase().includes(q));
  $('transactions').innerHTML=tx.map(t=>`<article class="historyItem"><div class="historyTop"><strong>${esc(t.ProductName)} · ${esc(t.Action)}</strong><small>${esc(new Date(t.Timestamp).toLocaleString())}</small></div><p>${fmt(t.Quantity)} unit(s) ${esc(t.FromLocation||'')} ${t.ToLocation?'→ '+esc(t.ToLocation):''}</p><pre>Before: ${esc(t.PreviousQty)}\nAfter: ${esc(t.NewQty)}</pre>${t.Notes?`<p>${esc(t.Notes)}</p>`:''}<small>Product ID: ${esc(t.ProductID)}</small></article>`).join('') || '<p class="empty">No matching activity in loaded history.</p>';
  $('moreHistory').hidden=!state.more;
}
async function loadHistory(reset=false) {
  if(state.busy)return; setBusy(true);
  const query = $('historySearch').value.trim();
  if(reset){state.offset=0;state.history=[];}
  try {
    const data=await readAPI('getTransactions',{offset:state.offset,limit:100,search:query});
    state.history.push(...data.transactions.filter(t=>!state.history.some(old=>old.TransactionID===t.TransactionID)));
    state.offset=data.nextOffset;state.more=data.hasMore;renderHistory();
  } catch(e){notify(e.message,true);} finally{
    setBusy(false);
    if (query !== $('historySearch').value.trim()) loadHistory(true);
  }
}
let historyTimer;
$('historySearch').oninput=()=>{renderHistory();clearTimeout(historyTimer);historyTimer=setTimeout(()=>loadHistory(true),300);}; $('moreHistory').onclick=()=>loadHistory(); $('refreshHistory').onclick=()=>loadHistory(true);
$('historyTab').onclick=()=>{ $('inventoryView').hidden=true;$('historyView').hidden=false;$('historyTab').setAttribute('aria-pressed','true');$('inventoryTab').setAttribute('aria-pressed','false');loadHistory(true); };
$('inventoryTab').onclick=()=>{ $('historyView').hidden=true;$('inventoryView').hidden=false;$('inventoryTab').setAttribute('aria-pressed','true');$('historyTab').setAttribute('aria-pressed','false'); };
load();
