/* Stockline camera barcode add-on. Classic deferred script AFTER categories.js. */
'use strict';
(() => {
  const LIBRARY_URL='https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/html5-qrcode.min.js';
  let libraryPromise;
  let session=null;
  let targetInput=null;
  let triggerButton=null;
  const dialog=document.createElement('dialog');
  dialog.id='barcodeDialog';dialog.className='barcode-dialog';
  dialog.setAttribute('aria-labelledby','barcodeTitle');
  dialog.innerHTML=`
    <div class="dialogHeader"><div><h2 id="barcodeTitle">Scan product barcode</h2><p class="muted">Place the whole barcode inside the camera view.</p></div><button type="button" id="barcodeClose" class="secondary icon" aria-label="Close barcode scanner">×</button></div>
    <p id="barcodeStatus" class="barcode-status" role="status" aria-live="polite"></p>
    <div id="barcodeReader" class="barcode-reader"></div>
    <div id="barcodeResult" hidden><label>Scanned SKU<input id="barcodeValue" type="text" maxlength="80" autocomplete="off" spellcheck="false"></label><p class="muted">Check the code against the label before using it. Leading zeros are kept.</p></div>
    <p id="barcodeError" class="error" role="alert"></p>
    <div class="dialogFooter"><button type="button" id="barcodeRetry" class="secondary">Restart camera</button><button type="button" id="barcodeCancel" class="secondary">Cancel</button><button type="button" id="barcodeUse" hidden>Use this barcode</button></div>`;
  document.body.append(dialog);
  const get=id=>document.getElementById(id);

  function loadLibrary(){
    if(window.Html5Qrcode)return Promise.resolve();
    if(libraryPromise)return libraryPromise;
    libraryPromise=new Promise((resolve,reject)=>{
      const script=document.createElement('script');let timer;
      function fail(){clearTimeout(timer);script.remove();libraryPromise=null;reject(Error('Could not load the barcode scanner. Check your connection or content blocker, or type the SKU manually.'));}
      script.src=LIBRARY_URL;script.async=true;
      script.onload=()=>{clearTimeout(timer);if(window.Html5Qrcode)resolve();else fail();};
      script.onerror=fail;timer=setTimeout(fail,20000);document.head.append(script);
    });
    return libraryPromise;
  }
  function cameraError(error){
    const name=error?.name||'';const message=String(error?.message||error||'');
    if(/NotAllowed|PermissionDenied|permission|denied/i.test(name+' '+message))return 'Camera access was denied or blocked. Allow camera access in this site’s browser settings, then tap Restart camera. You can also enter the SKU manually.';
    if(/NotFound|DevicesNotFound/i.test(name+' '+message))return 'No camera was found. Open this site on a phone with a camera, or type the SKU manually.';
    if(/NotReadable|TrackStart|Could not start/i.test(name+' '+message))return 'The camera could not start. Close other apps or tabs using it, then try again.';
    return message||'The camera could not start. You can still type the SKU manually.';
  }
  async function release(s){
    if(!s)return;
    s.cancelled=true;
    if(s.cleanup)return s.cleanup;
    s.cleanup=(async()=>{
      // A permission prompt can outlive the dialog. Stop immediately if a
      // cancelled start later succeeds; do not reuse the reader before cleanup.
      if(s.startPromise){try{await s.startPromise;}catch{}}
      if(s.running){try{await s.reader.stop();}catch{}s.running=false;}
      if(s.reader){try{s.reader.clear();}catch{}}
    })();
    await s.cleanup;
  }
  async function startCamera(){
    if(!dialog.open)return;
    const previous=session;
    if(previous)previous.cancelled=true;
    const s={reader:null,running:false,cancelled:false,decoded:false,startPromise:null,cleanup:null};session=s;
    get('barcodeRetry').disabled=true;get('barcodeError').textContent='';
    get('barcodeResult').hidden=true;get('barcodeUse').hidden=true;
    get('barcodeReader').hidden=false;get('barcodeStatus').textContent='Preparing camera…';
    try{
      await release(previous);
      if(s.cancelled||session!==s||!dialog.open)return;
      if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia)throw Error('Camera scanning requires HTTPS and a supported browser. Open the hosted site directly in Safari, Chrome, or Firefox, or enter the SKU manually.');
      await loadLibrary();
      if(s.cancelled||session!==s||!dialog.open)return;
      const F=window.Html5QrcodeSupportedFormats;
      const formats=[F.EAN_13,F.EAN_8,F.UPC_A,F.UPC_E,F.CODE_128,F.CODE_39,F.CODE_93,F.ITF,F.CODABAR];
        s.reader = new window.Html5Qrcode('barcodeReader', {
          verbose: false
        });
      get('barcodeStatus').textContent='Allow camera access if asked, then aim at the barcode.';
      s.startPromise=s.reader.start(
        {facingMode:'environment'},
            {
              fps: 8,
              disableFlip: false,
              videoConstraints: {
                facingMode: { ideal: 'environment' },
                width: { ideal: 1920 },
                height: { ideal: 1080 }
              }
            },        
        text=>{
          if(s.cancelled||s.decoded||session!==s||!dialog.open)return;
          console.info('Stockline decoded barcode:', text);
          const value=String(text).trim();
          if(!value||value.length>80){get('barcodeError').textContent='This barcode is empty or longer than the 80-character SKU limit. Scan another label.';return;}
          s.decoded=true;
          // Queue completion until start() has returned its promise.
          queueMicrotask(()=>acceptScan(s,value));
        },
        ()=>{} // Frame-by-frame decode misses are normal, not actionable errors.
      );
      await s.startPromise;s.running=true;
      if(s.cancelled||session!==s||!dialog.open){await release(s);return;}
      if(!s.decoded)get('barcodeStatus').textContent='Scanning… Hold steady with the full barcode visible and well lit.';
    }catch(error){
      if(!s.cancelled&&session===s&&dialog.open){get('barcodeError').textContent=cameraError(error);get('barcodeStatus').textContent='Scanner unavailable. Manual SKU entry still works.';}
    }finally{
      if(session===s&&dialog.open)get('barcodeRetry').disabled=false;
    }
  }
  async function acceptScan(s,value){
    await release(s);
    if(session!==s||!dialog.open)return;
    get('barcodeReader').hidden=true;get('barcodeValue').value=value;
    get('barcodeResult').hidden=false;get('barcodeUse').hidden=false;
    get('barcodeStatus').textContent='Barcode found. Review it, then use it as the SKU.';
    get('barcodeRetry').textContent='Scan again';get('barcodeRetry').disabled=false;
    get('barcodeUse').focus();
  }
  function closeScanner(){
    if(dialog.open)dialog.close();
  }
  dialog.addEventListener('close',()=>{
    const old=session;if(old)old.cancelled=true;
    void release(old);
    // Keep the session reference until cleanup finishes, so rapid reopening
    // waits before attaching another camera to the same reader element.
    if(triggerButton?.isConnected)triggerButton.focus();
  });
  get('barcodeClose').onclick=closeScanner;get('barcodeCancel').onclick=closeScanner;
  get('barcodeRetry').onclick=()=>{get('barcodeRetry').textContent='Restart camera';void startCamera();};
  get('barcodeUse').onclick=()=>{
    const value=get('barcodeValue').value.trim();
    if(!value||value.length>80){get('barcodeError').textContent='Enter a barcode between 1 and 80 characters.';return;}
    // When opened from Search, use the barcode as a search query.
if (targetInput === $('search')) {
  targetInput.value = value;

  // Clear filters so they don't hide the scanned product.
  $('filter').value = 'all';

  const categoryFilter = document.getElementById('categoryFilter');
  if (categoryFilter) {
    categoryFilter.value = '';
  }

  targetInput.dispatchEvent(new Event('input', { bubbles: true }));

  closeScanner();

  // Restore focus after the scanner's normal close handler finishes.
  setTimeout(() => $('search').focus(), 0);
  return;
}
    if(!targetInput?.isConnected||!$('editor').open){closeScanner();return;}
    const duplicate=state.items.find(p=>p.ID!==selected?.ID&&String(p.SKU||'').trim().toLowerCase()===value.toLowerCase());
    if(duplicate){get('barcodeError').textContent='That SKU is already used by '+duplicate.Name+'. Scan another item or cancel.';return;}
    targetInput.value=value;
    targetInput.dispatchEvent(new Event('input',{bubbles:true}));
    targetInput.dispatchEvent(new Event('change',{bubbles:true}));
    closeScanner();targetInput.focus();
  };
  const previousOpenEditor=openEditor;
  openEditor=function openEditorWithBarcode(action,id){
    previousOpenEditor(action,id);
    if(!$('editor').open||!['addItem','editItem'].includes(action))return;
    const input=$('fields').querySelector('input[name="SKU"]');
    if(!input||input.closest('.sku-scan-row'))return;
    input.autocomplete='off';input.spellcheck=false;input.type='text';
    const row=document.createElement('div');row.className='sku-scan-row';
    input.parentElement.insertBefore(row,input);row.append(input);
    const button=document.createElement('button');button.type='button';button.className='sku-scan-button secondary';
    button.setAttribute('aria-label','Scan a barcode into the SKU field');button.setAttribute('aria-haspopup','dialog');
    button.setAttribute('aria-controls','barcodeDialog');
    button.innerHTML='<svg viewBox="0 0 24 24" width="21" height="21" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 7V4h3m10 0h3v3M4 17v3h3m10 0h3v-3M7 8v8m3-8v8m3-8v8m4-8v8"/></svg><span>Scan</span>';
    button.onclick=event=>{
      event.preventDefault();targetInput=input;triggerButton=button;
      get('barcodeError').textContent='';get('barcodeRetry').textContent='Restart camera';
get('barcodeTitle').textContent = 'Scan product barcode';
get('barcodeUse').textContent = 'Use this barcode';

dialog.showModal();
void startCamera();    };
    row.append(button);
  };
  // Add a scanner button beside the inventory search field.
const searchInput = $('search');

if (searchInput && !document.getElementById('searchBarcodeButton')) {
  const searchRow = document.createElement('div');
  searchRow.className = 'sku-scan-row search-scan-row';

  searchInput.parentElement.insertBefore(searchRow, searchInput);
  searchRow.append(searchInput);

  const searchButton = document.createElement('button');
  searchButton.id = 'searchBarcodeButton';
  searchButton.type = 'button';
  searchButton.className = 'sku-scan-button secondary';

  searchButton.setAttribute('aria-label', 'Scan a barcode to search inventory');
  searchButton.setAttribute('aria-haspopup', 'dialog');
  searchButton.setAttribute('aria-controls', 'barcodeDialog');

  searchButton.innerHTML = `
    <svg
      viewBox="0 0 24 24"
      width="21"
      height="21"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
    >
      <path d="M4 7V4h3m10 0h3v3M4 17v3h3m10 0h3v-3M7 8v8m3-8v8m3-8v8m4-8v8"/>
    </svg>
    <span>Scan</span>
  `;

  searchButton.onclick = event => {
    event.preventDefault();

    targetInput = searchInput;
    triggerButton = searchButton;

    get('barcodeTitle').textContent = 'Scan to search inventory';
    get('barcodeUse').textContent = 'Search this barcode';
    get('barcodeError').textContent = '';
    get('barcodeRetry').textContent = 'Restart camera';

    dialog.showModal();
    void startCamera();
  };

  searchRow.append(searchButton);
}
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&dialog.open)closeScanner();});
  window.addEventListener('pagehide',()=>{if(session)void release(session);});
})();
