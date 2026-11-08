/* Load after barcode.js, categories.js and queue.js as a classic deferred script. */
'use strict';
(() => {
  let matches=[];let product=null;
  const dialog=document.createElement('dialog');dialog.id='stockDeltaDialog';
  dialog.setAttribute('aria-labelledby','stockDeltaTitle');
  dialog.innerHTML=`<form id="stockDeltaForm">
    <div class="dialogHeader"><div><h2 id="stockDeltaTitle">Item already in inventory</h2><p class="muted">Add or remove units instead of creating a duplicate.</p></div><button type="button" id="stockDeltaClose" class="secondary icon" aria-label="Close stock changes">×</button></div>
    <label id="stockDeltaChoiceLabel" hidden>Choose the matching product<select id="stockDeltaChoice"></select></label>
    <div id="stockDeltaProduct" class="context"></div>
    <p class="muted">These are changes, not new totals. Positive adds stock; negative removes it. Leave 0 for no change.</p>
    <div class="pair">
      <label>Home / Storage change<input id="stockDeltaHome" name="HomeDelta" type="number" value="0" min="-1000000000" max="1000000000" step="1" required></label>
      <label>Truck change<input id="stockDeltaTruck" name="TruckDelta" type="number" value="0" min="-1000000000" max="1000000000" step="1" required></label>
    </div>
    <p id="stockDeltaPreview" class="muted" role="status" aria-live="polite"></p>
    <label>Optional reason<textarea id="stockDeltaNote" maxlength="2000" placeholder="Received stock, used on a job, damaged…"></textarea></label>
    <p id="stockDeltaError" class="error" role="alert"></p>
    <div class="dialogFooter"><button type="button" id="stockDeltaCancel" class="secondary">Cancel</button><button type="submit">Queue stock change</button></div>
  </form>`;
  document.body.append(dialog);
  const get=id=>document.getElementById(id);
  const sign=n=>n>0?'+'+n:String(n);
  function preview(){
    if(!product)return;
    const h=Number(get('stockDeltaHome').value),t=Number(get('stockDeltaTruck').value);
    get('stockDeltaPreview').textContent=Number.isSafeInteger(h)&&Number.isSafeInteger(t)
      ?'Estimated after change: Home '+(product.HomeQty+h)+' · Truck '+(product.TruckQty+t)+'. Based on currently confirmed counts; pending changes may affect the result.'
      :'Enter whole numbers for both changes.';
  }
  function selectProduct(){
    product=matches.find(p=>String(p.ID)===get('stockDeltaChoice').value)||matches[0];
    get('stockDeltaProduct').innerHTML='<strong>'+esc(product.Name)+'</strong><br>SKU: '+esc(product.SKU)+'<br>Currently confirmed: Home '+fmt(product.HomeQty)+' · Truck '+fmt(product.TruckQty);
    preview();
  }
  window.stocklineUseExistingScannedSKU=function(value,closeScanner){
    // Only scans from Add Item are redirected. Search and Edit retain their behavior.
    if(mode!=='addItem'||!$('editor').open)return false;
    const code=String(value).trim().toLowerCase();
    matches=state.items.filter(p=>String(p.SKU||'').trim().toLowerCase()===code);
    if(!matches.length)return false;
    closeScanner();
    get('stockDeltaForm').reset();get('stockDeltaError').textContent='';
    get('stockDeltaChoiceLabel').hidden=matches.length<2;
    get('stockDeltaChoice').innerHTML=matches.map(p=>'<option value="'+esc(p.ID)+'">'+esc(p.Name)+' · '+esc(p.ID)+'</option>').join('');
    get('stockDeltaChoice').value=String(matches[0].ID);selectProduct();
    dialog.showModal();
    // Let the scanner's close/focus handler finish before focusing this modal.
    setTimeout(()=>{if(dialog.open){get('stockDeltaHome').focus();get('stockDeltaHome').select();}},0);
    return true;
  };
  get('stockDeltaChoice').onchange=selectProduct;
  get('stockDeltaHome').oninput=preview;get('stockDeltaTruck').oninput=preview;
  function cancel(){dialog.close();}
  get('stockDeltaCancel').onclick=cancel;get('stockDeltaClose').onclick=cancel;
  get('stockDeltaForm').addEventListener('submit',event=>{
    event.preventDefault();get('stockDeltaError').textContent='';
    if(!product)return;
    if(!state.live||state.busy){get('stockDeltaError').textContent='Wait for the live inventory connection/read, then try again.';return;}
    function delta(id,label){
      const raw=get(id).value.trim();
      if(!/^[+-]?\d+$/.test(raw))throw Error(label+' must be a whole number. Use a minus sign to remove units.');
      const n=Number(raw);if(!Number.isSafeInteger(n)||Math.abs(n)>1000000000)throw Error(label+' is outside the allowed range.');return n;
    }
    try{
      const h=delta('stockDeltaHome','Home change'),t=delta('stockDeltaTruck','Truck change');
      if(h===0&&t===0)throw Error('Enter a nonzero change for at least one location.');
      // Do NOT convert to absolute counts: backend applies signed deltas under lock.
      // Do not reject by preview count: earlier queued changes can affect availability.
      const payload={action:'adjustBy',id:product.ID,expectedUpdatedAt:product.UpdatedAt,HomeDelta:h,TruckDelta:t,note:get('stockDeltaNote').value.trim(),queueDescription:'Change '+product.Name+' — Home '+sign(h)+', Truck '+sign(t)};
      dialog.close();commit(payload);
    }catch(error){get('stockDeltaError').textContent=error.message;}
  });
})();
