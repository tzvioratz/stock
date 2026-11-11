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
    get('stockDeltaProduct').innerHTML='<strong>'+esc(product.Name)+'</strong><br>Part number: '+esc(product.PartNumber || 'Not set')+'<br>Currently confirmed: Home '+fmt(product.HomeQty)+' · Truck '+fmt(product.TruckQty);
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
    // Also allow typed/pasted SKUs to open the existing stock-change dialog.
  function openExistingTypedSKU() {
    if (
      mode !== 'addItem' ||
      !$('editor').open ||
      !state.live ||
      state.busy
    ) {
      return false;
    }

    // If the stock dialog has already opened during a field change,
    // treat the action as handled and do not submit Add Item.
    if (dialog.open) return true;

    const skuInput =
      $('fields').querySelector('input[name="SKU"]');

    const code = String(skuInput?.value || '').trim();

    // Do not match other products that also have an empty SKU.
    if (!code) return false;

    return window.stocklineUseExistingScannedSKU(
      code,
      () => {
        // This came from typing, not scanning:
        // there is no scanner dialog to close.
      }
    );
  }

  // Typing/pasting: check after the user finishes and leaves the field.
  $('fields').addEventListener('change', event => {
    if (
      event.target.matches('input[name="SKU"]') &&
      mode === 'addItem'
    ) {
      openExistingTypedSKU();
    }
  });

  // Enter in SKU: open matching inventory before normal form validation.
  // This works even if Product name has not been entered yet.
  $('fields').addEventListener('keydown', event => {
    if (
      event.key !== 'Enter' ||
      event.isComposing ||
      !event.target.matches('input[name="SKU"]') ||
      mode !== 'addItem'
    ) {
      return;
    }

    if (openExistingTypedSKU()) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);

  // Check Save clicks before native required-field validation.
  // Prevent creating a duplicate if an existing SKU is found.
  $('editorForm').addEventListener('click', event => {
    const button = event.target.closest('button, input');

    if (
      !button ||
      button.form !== $('editorForm') ||
      !['submit', 'image'].includes(button.type)
    ) {
      return;
    }

    if (openExistingTypedSKU()) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);

  // Safety net for other normal form-submission paths.
  // Capture runs before the existing non-capture submit handler.
  $('editorForm').addEventListener('submit', event => {
    if (openExistingTypedSKU()) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);
    // Keep product names clickable even when another add-on
  // redraws the cards with plain <h3> headings.
  function ensureStockNameButtons() {
    $('products').querySelectorAll('.product').forEach(card => {
      const heading = card.querySelector('h3');

      if (!heading) return;

      // Already upgraded: leave it alone.
      if (heading.querySelector('[data-stock-id]')) return;

      // Avoid replacing any other interactive heading.
      if (heading.querySelector('button, a, input, select, textarea')) {
        return;
      }

      // Existing Move / Adjust / Edit buttons carry the item ID.
      const actionButton =
        card.querySelector('[data-action][data-id]');

      if (!actionButton) return;

      const itemId = actionButton.dataset.id;
      const itemName = heading.textContent.trim();

      if (!itemId || !itemName) return;

      const button = document.createElement('button');

      button.type = 'button';
      button.className = 'item-stock-button';
      button.dataset.stockId = itemId;
      button.textContent = itemName;

      button.setAttribute(
        'aria-label',
        'Add or remove inventory for ' + itemName
      );

      heading.replaceChildren(button);
    });
  }

  const stockNameObserver =
    new MutationObserver(ensureStockNameButtons);

  stockNameObserver.observe($('products'), {
    childList: true,
    subtree: true
  });

  // Upgrade any cards already displayed.
  ensureStockNameButtons();
    // Clicking an inventory item's name opens its stock-change dialog.
  $('products').addEventListener('click', event => {
    const button = event.target.closest('[data-stock-id]');

    if (!button || !$('products').contains(button)) return;

    if (!state.live || state.busy) {
      notify(
        'Wait for the live inventory connection/read, then try again.',
        true
      );
      return;
    }

    if (dialog.open) return;

    const item = state.items.find(
      p => String(p.ID) === button.dataset.stockId
    );

    if (!item) {
      notify('This item is no longer loaded. Refresh inventory.', true);
      return;
    }

    // Use the exact item ID, not its SKU.
    // This also works for items without a SKU.
    matches = [item];
    returnFocus = button;

    get('stockDeltaForm').reset();
    get('stockDeltaError').textContent = '';

    get('stockDeltaChoiceLabel').hidden = true;

    get('stockDeltaChoice').innerHTML =
      '<option value="' + esc(item.ID) + '">' +
      esc(item.Name) +
      '</option>';

    get('stockDeltaChoice').value = String(item.ID);

    selectProduct();
    dialog.showModal();

    setTimeout(() => {
      if (dialog.open) {
        get('stockDeltaHome').focus();
        get('stockDeltaHome').select();
      }
    }, 0);
  });
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
