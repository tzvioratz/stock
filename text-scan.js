/* Stockline photo OCR. Classic deferred script AFTER all existing add-ons. */
'use strict';
function stocklineOCRText(value){
  // Preserve letters, punctuation and leading zeros; never guess O/0 or I/1.
  return String(value||'').replace(/[\r\n]+/g,' ').replace(/\s+/g,' ').trim();
}
(() => {
  const LIB='https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
  let loading=null,session=null,destination=null,trigger=null,selection=null,drag=null;
  const dialog=document.createElement('dialog');dialog.id='textScanDialog';dialog.className='text-scan-dialog';
  dialog.setAttribute('aria-labelledby','textScanTitle');
  dialog.innerHTML=`<div class="dialogHeader"><div><h2 id="textScanTitle">Read a printed product number</h2><p class="muted">Photograph the label, then select only the number to read.</p></div><button id="textScanClose" type="button" class="secondary icon" aria-label="Close text scanner">×</button></div>
    <input id="textScanFile" type="file" accept="image/*" capture="environment" hidden>
    <button id="textScanPhoto" type="button" class="secondary">Take / choose photo</button>
    <p id="textScanStatus" role="status" aria-live="polite" class="muted"></p>
    <div id="textScanImageArea" hidden><p class="muted">Drag a rectangle around ONE product number, excluding headings and other text. Or tap Select whole image.</p><canvas id="textScanCanvas" aria-label="Photo preview. Drag to select the product number."></canvas><div class="text-scan-tools"><button type="button" id="textScanWhole" class="secondary">Select whole image</button><button type="button" id="textScanRead">Read selected text</button></div></div>
    <div id="textScanResult" hidden><label>Recognized product number<input id="textScanValue" type="text" maxlength="80" autocomplete="off" spellcheck="false"></label><p class="muted">Check every character, especially O / 0 and I / 1. You can correct the text before using it.</p></div>
    <p id="textScanError" class="error" role="alert"></p>
    <div class="dialogFooter"><button type="button" id="textScanCancel" class="secondary">Cancel</button><button type="button" id="textScanUse" hidden>Use product number</button></div>`;
  document.body.append(dialog);
  const get=id=>document.getElementById(id),preview=get('textScanCanvas');
  function loadOCR(){
    if(window.Tesseract)return Promise.resolve();
    if(loading)return loading;
    loading=new Promise((resolve,reject)=>{
      const script=document.createElement('script');let timer;
      function fail(){clearTimeout(timer);script.remove();loading=null;reject(Error('OCR could not load. Check your connection/content blocker, or enter the number manually.'));}
      script.src=LIB;script.async=true;script.onerror=fail;
      script.onload=()=>{clearTimeout(timer);window.Tesseract?resolve():fail();};
      timer=setTimeout(fail,25000);document.head.append(script);
    });return loading;
  }
  function current(s){return session===s&&!s.cancelled&&dialog.open;}
  function cleanup(s){
    if(!s)return;s.cancelled=true;
    if(s.worker){void s.worker.terminate().catch(()=>{});s.worker=null;}
    // If loading finishes after close, terminate the late worker as well.
    if(s.creating)s.creating.then(worker=>worker.terminate()).catch(()=>{});
    s.source=null;
  }
  function busy(s,value){
    if(!current(s))return;
    s.busy=value;
    ['textScanPhoto','textScanRead','textScanWhole','textScanUse'].forEach(id=>get(id).disabled=value);
    // Close/Cancel always remain usable during model download or recognition.
  }
  function redraw(){
    if(!session?.source)return;
    const ctx=preview.getContext('2d');ctx.clearRect(0,0,preview.width,preview.height);
    ctx.drawImage(session.source,0,0,preview.width,preview.height);
    if(selection){ctx.strokeStyle='#245ce5';ctx.lineWidth=3;ctx.setLineDash([8,5]);ctx.strokeRect(selection.x,selection.y,selection.w,selection.h);ctx.setLineDash([]);}
  }
  function whole(){selection={x:1,y:1,w:Math.max(1,preview.width-2),h:Math.max(1,preview.height-2)};redraw();}
  function point(event){const r=preview.getBoundingClientRect();return {x:Math.max(0,Math.min(preview.width,(event.clientX-r.left)*preview.width/r.width)),y:Math.max(0,Math.min(preview.height,(event.clientY-r.top)*preview.height/r.height))};}
  preview.addEventListener('pointerdown',event=>{
    if(!session?.source||session.busy)return;event.preventDefault();drag=point(event);preview.setPointerCapture(event.pointerId);
  });
  preview.addEventListener('pointermove',event=>{
    if(!drag||session?.busy)return;const p=point(event);selection={x:Math.min(drag.x,p.x),y:Math.min(drag.y,p.y),w:Math.abs(p.x-drag.x),h:Math.abs(p.y-drag.y)};redraw();
  });
  function finishDrag(){if(!drag)return;drag=null;if(selection&&(selection.w<8||selection.h<8)){selection=null;redraw();}}
  preview.addEventListener('pointerup',finishDrag);preview.addEventListener('pointercancel',finishDrag);
  get('textScanWhole').onclick=whole;
  get('textScanPhoto').onclick=()=>{get('textScanFile').value='';get('textScanFile').click();};
  get('textScanFile').addEventListener('change',async event=>{
    const file=event.target.files?.[0],s=session;if(!file||!s)return;
    get('textScanError').textContent='';get('textScanResult').hidden=true;get('textScanUse').hidden=true;
    if(!file.type.startsWith('image/')){get('textScanError').textContent='Choose a photo image.';return;}
    if(file.size>25*1024*1024){get('textScanError').textContent='Photo is too large. Choose an image smaller than 25 MB.';return;}
    busy(s,true);get('textScanStatus').textContent='Opening photo…';
    const url=URL.createObjectURL(file);
    try{
      const image=new Image();await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(Error('This image could not be opened. Try a JPEG or PNG photo.'));image.src=url;});
      if(!current(s))return;
      const scale=Math.min(1,4096/Math.max(image.naturalWidth,image.naturalHeight));
      const source=document.createElement('canvas');source.width=Math.max(1,Math.round(image.naturalWidth*scale));source.height=Math.max(1,Math.round(image.naturalHeight*scale));
      source.getContext('2d').drawImage(image,0,0,source.width,source.height);s.source=source;
      const pscale=Math.min(1,900/source.width);preview.width=Math.max(1,Math.round(source.width*pscale));preview.height=Math.max(1,Math.round(source.height*pscale));
      selection=null;drag=null;redraw();get('textScanImageArea').hidden=false;
      get('textScanStatus').textContent='Select the product-number line, then tap Read selected text.';
    }catch(error){if(current(s))get('textScanError').textContent=error.message;}
    finally{URL.revokeObjectURL(url);busy(s,false);}
  });
  get('textScanRead').onclick=async()=>{
    const s=session;if(!s?.source||s.busy)return;
    get('textScanError').textContent='';get('textScanResult').hidden=true;get('textScanUse').hidden=true;
    if(!selection||selection.w<8||selection.h<8){get('textScanError').textContent='Drag a rectangle around the number, or choose Select whole image.';return;}
    const r={...selection};busy(s,true);
    try{
      get('textScanStatus').textContent='Loading text reader… The first use downloads OCR files and can take a while.';
      await loadOCR();if(!current(s))return;
      if(!s.worker){
        s.creating=window.Tesseract.createWorker('eng',1,{
          workerPath:'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js',
          logger:m=>{if(current(s)&&m.status){const percent=Number.isFinite(m.progress)?' '+Math.round(m.progress*100)+'%':'';get('textScanStatus').textContent=m.status+percent;}}
        });
        const worker=await s.creating;s.creating=null;
        if(!current(s)){await worker.terminate();return;}s.worker=worker;
        await s.worker.setParameters({tessedit_pageseg_mode:window.Tesseract.PSM.SINGLE_LINE});
      }
      if(!current(s))return;
      const sx=r.x*s.source.width/preview.width,sy=r.y*s.source.height/preview.height;
      const sw=r.w*s.source.width/preview.width,sh=r.h*s.source.height/preview.height;
      const factor=Math.min(3,Math.max(1,1600/sw),3200/sw,1200/sh);
      const crop=document.createElement('canvas');crop.width=Math.max(1,Math.round(sw*factor));crop.height=Math.max(1,Math.round(sh*factor));
      const ctx=crop.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,crop.width,crop.height);ctx.drawImage(s.source,sx,sy,sw,sh,0,0,crop.width,crop.height);
      get('textScanStatus').textContent='Reading selected text…';
      const result=await s.worker.recognize(crop);if(!current(s))return;
      const text=stocklineOCRText(result.data.text);
      if(!text)throw Error('No text was found. Try a sharper photo and a tighter selection around the number.');
      get('textScanValue').value=text;get('textScanResult').hidden=false;
      get('textScanUse').hidden=false;
      if(text.length>80)get('textScanError').textContent='The result exceeds 80 characters. Select only the product number or shorten it manually before using it.';
      get('textScanStatus').textContent='Text found. Verify it before using it.';get('textScanValue').focus();
    }catch(error){if(current(s)){get('textScanError').textContent=error.message||'Text recognition failed. Try again or type the number manually.';get('textScanStatus').textContent='Unable to read this selection.';}}
    finally{busy(s,false);}
  };
  function open(input,button){
    cleanup(session);session={cancelled:false,busy:false,worker:null,creating:null,source:null};destination=input;trigger=button;selection=null;drag=null;
    get('textScanImageArea').hidden=true;get('textScanResult').hidden=true;get('textScanUse').hidden=true;
    get('textScanError').textContent='';get('textScanStatus').textContent='Take a clear photo of the printed product number.';
    ['textScanPhoto','textScanRead','textScanWhole','textScanUse'].forEach(id=>get(id).disabled=false);
    get('textScanUse').textContent=input===$('search')?'Search this number':'Use as SKU';
    dialog.showModal();get('textScanFile').value='';
    // Invoke from the direct user gesture; browser may offer camera or photo picker.
    get('textScanFile').click();
  }
  get('textScanUse').onclick=()=>{
    const text=stocklineOCRText(get('textScanValue').value);
    if(!text||text.length>80){get('textScanError').textContent='Enter a product number between 1 and 80 characters.';return;}
    if(!destination?.isConnected){dialog.close();return;}
    const target=destination;
    if(target===$('search')){
      target.value=text;$('filter').value='all';const category=document.getElementById('categoryFilter');if(category)category.value='';
      target.dispatchEvent(new Event('input',{bubbles:true}));dialog.close();setTimeout(()=>target.focus(),0);return;
    }
    if(!$('editor').open){dialog.close();return;}
    if(typeof window.stocklineUseExistingScannedSKU==='function'&&window.stocklineUseExistingScannedSKU(text,()=>dialog.close()))return;
    target.value=text;target.dispatchEvent(new Event('input',{bubbles:true}));target.dispatchEvent(new Event('change',{bubbles:true}));
    dialog.close();setTimeout(()=>{if(target.isConnected&&$('editor').open)target.focus();},0);
  };
  function close(){dialog.close();}
  get('textScanClose').onclick=close;get('textScanCancel').onclick=close;
  dialog.addEventListener('close',()=>{cleanup(session);preview.width=1;preview.height=1;get('textScanFile').value='';if(trigger?.isConnected)trigger.focus();});
  function attach(input){
    if(!input||input.parentElement.querySelector('.text-scan-button'))return;
    let row=input.closest('.sku-scan-row');
    if(!row){row=document.createElement('div');row.className='sku-scan-row';input.parentElement.insertBefore(row,input);row.append(input);}
    const button=document.createElement('button');button.type='button';button.className='secondary text-scan-button';button.textContent='Text';
    button.setAttribute('aria-label',input===$('search')?'Read a printed product number to search':'Read a printed product number into SKU');button.setAttribute('aria-haspopup','dialog');
    button.onclick=event=>{event.preventDefault();open(input,button);};row.append(button);
  }
  const previousOpenEditor=openEditor;
  openEditor=function openEditorWithTextScan(action,id){previousOpenEditor(action,id);if($('editor').open&&['addItem','editItem'].includes(action))attach($('fields').querySelector('input[name="SKU"]'));};
  attach($('search'));
  window.addEventListener('pagehide',()=>cleanup(session));
})();
