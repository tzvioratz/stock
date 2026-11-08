/* Stockline queue add-on. Load AFTER script.js using a classic deferred script.
   Requires the original app globals and the previously corrected writeAPI origin check.
   Inventory remains server-confirmed; pending operations are NOT counted as saved stock. */
'use strict';
(() => {
  if (typeof state === 'undefined' || typeof writeAPI !== 'function') {
    throw new Error('Load queue.js after the original Stockline script.js.');
  }
  const jobs = [];
  const revisions = new Map();
  let running = false;
  let paused = false;
  let listSignature = '';
  let focusBeforeQueue;
  let hideTimer;

  const ui = document.createElement('div');
  ui.innerHTML = `
    <div id="queueAnnouncement" class="queue-sr" role="status" aria-live="polite"></div>
    <button id="queueBar" class="queue-bar" type="button" aria-haspopup="dialog" aria-controls="queueDialog" hidden>
      <span class="queue-indicator" aria-hidden="true"></span>
      <span class="queue-bar-copy"><span id="queueCount"></span><small id="queueSubtitle"></small></span>
      <span class="queue-chevron" aria-hidden="true">↑</span>
    </button>
    <dialog id="queueDialog" class="queue-dialog" aria-labelledby="queueTitle">
      <div class="dialogHeader"><div><h2 id="queueTitle">Transaction queue</h2><p class="muted" id="queueDetail"></p></div>
      <button id="queueClose" class="secondary icon" type="button" aria-label="Close transaction queue">×</button></div>
      <div id="queueItems" class="queue-items"></div>
      <p class="muted queue-footnote">Keep this page open until saving finishes. Quantities in inventory show confirmed saves, not pending changes.</p>
      <div class="dialogFooter"><button id="queueClear" class="secondary" type="button">Clear finished</button></div>
    </dialog>`;
  document.body.append(ui);
  const el = id => document.getElementById(id);
  const active = () => jobs.filter(j => j.status === 'waiting' || j.status === 'saving');
  const attention = () => jobs.filter(j => j.status === 'failed' || j.status === 'uncertain');
  const key = (id,version) => JSON.stringify([id,version]);

  function resolveRevision(id,version) {
    const seen = new Set();
    while (revisions.has(key(id,version))) {
      const k = key(id,version);
      if (seen.has(k)) break;
      seen.add(k); version = revisions.get(k);
    }
    return version;
  }

  function description(p) {
    const product = state.items.find(item => item.ID === p.id);
    const name = p.Name || product?.Name || 'item';
    switch (p.action) {
      case 'addItem': return `Add new item — ${name}`;
      case 'editItem': return `Edit ${name}`;
      case 'transfer': return `Move ${p.quantity} × ${name} to ${p.to === 'Truck' ? 'Truck' : 'Home / Storage'}`;
      case 'adjust': return `Set ${name} at ${p.location === 'Truck' ? 'Truck' : 'Home / Storage'} to ${p.quantity}`;
      case 'archiveItem': return `Archive ${name}`;
      default: return p.queueDescription || 'Inventory change';    }
  }

  function renderQueue(announce = false) {
    const count = active().length;
    const problems = attention().length;
    const bar = el('queueBar');
    bar.hidden = count === 0 && problems === 0;
    bar.classList.toggle('queue-needs-attention', problems > 0);
    bar.classList.toggle('queue-is-running', running && !paused);
    document.body.classList.toggle('has-stockline-queue', !bar.hidden);
    el('queueCount').textContent = count
      ? `${count} transaction${count === 1 ? '' : 's'} in queue`
      : `${problems} transaction${problems === 1 ? '' : 's'} need attention`;
    el('queueSubtitle').textContent = paused
      ? 'Paused · check the unconfirmed save'
      : problems ? `${problems} need attention · tap to review`
      : 'Saving in the background · tap to view';
    el('queueDetail').textContent = `${count} pending · ${jobs.filter(j=>j.status==='done').length} completed · ${problems} need attention`;
    if (announce) el('queueAnnouncement').textContent = el('queueCount').textContent + '. ' + el('queueSubtitle').textContent;

    const signature = JSON.stringify(jobs.map(j=>[j.id,j.status,j.error]));
    // Avoid replacing focused controls when nothing changed.
    if (signature !== listSignature) {
      listSignature = signature;
      const focused = document.activeElement;
      const oldId = focused?.dataset?.job;
      const oldAction = focused?.dataset?.queueAction;
      el('queueItems').innerHTML = jobs.map(j => {
        const labels = {waiting:'Waiting',saving:'Saving…',done:'Saved',failed:'Not saved',uncertain:'Confirmation missing'};
        let controls = '';
        if (j.status === 'uncertain') controls = `
          <button type="button" class="secondary" data-queue-action="retry" data-job="${esc(j.id)}">Check / retry same request</button>`;
        if (j.status === 'failed') controls = `
          <button type="button" class="secondary" data-queue-action="dismiss" data-job="${esc(j.id)}">Dismiss</button>`;
        return `<article class="queue-card queue-${j.status}">
          <div class="queue-card-top"><h3>${esc(j.description)}</h3><span class="queue-state">${labels[j.status]}</span></div>
          <small>${esc(j.time)}</small>
          ${j.error ? `<p class="queue-error">${esc(j.error)}</p>` : ''}
          ${controls ? `<div class="queue-card-actions">${controls}</div>` : ''}
        </article>`;
      }).join('') || '<p class="empty">No queued transactions.</p>';
      if (oldId && oldAction) {
        const replacement = [...el('queueItems').querySelectorAll('button')].find(b=>b.dataset.job===oldId && b.dataset.queueAction===oldAction);
        if(replacement) replacement.focus();
        else if (el('queueDialog').open) el('queueClose').focus();
      }
    }
  }

  function blockDependents(job, message) {
    if (!job.payload.id) return;
    jobs.filter(j=>j.status==='waiting' && j.payload.id===job.payload.id).forEach(j=>{
      j.status='failed';j.error=message;
    });
  }

  function applyConfirmedItem(item) {
    if (!item) return;
    state.items = state.items.filter(p=>p.ID!==item.ID);
    if (item.Active) state.items.push(item);
    render();
    state.history=[];state.offset=0;
    if (typeof renderHistory === 'function') renderHistory();
    $('syncStatus').textContent='Live inventory · last save '+new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
  }

  async function worker() {
    if (running || paused) return;
    const job=jobs.find(j=>j.status==='waiting');
    if (!job) {renderQueue();return;}
    // Let an existing initial/manual read finish before starting a write.
    if (state.busy) {setTimeout(worker,150);return;}
    running=true;job.status='saving';job.error='';
    if (!job.sentPayload) {
      job.sentPayload={...job.payload};
      if (job.payload.id) job.sentPayload.expectedUpdatedAt=resolveRevision(job.payload.id,job.payload.expectedUpdatedAt);
    }
    renderQueue(true);
    let confirmed=false;
    try {
      const result=await writeAPI(job.sentPayload);
      confirmed=true;
      if (result.duplicate) {
        // The original request committed but its response was lost. A current read
        // cannot prove no third party edited afterward: do not rebase dependents.
        job.status='done';job.error='Original request was already saved; it was not applied again.';
        blockDependents(job,'An earlier save was recovered. Refresh this product and re-enter this pending change.');
        try {
          const snapshot=await readAPI('getInventory');
          state.items=snapshot.items;render();state.history=[];state.offset=0;
        } catch (error) {
          state.live=false;
          document.querySelectorAll('[data-action],#add').forEach(b=>b.disabled=true);
          notify('Save confirmed, but inventory could not refresh. Refresh before making more changes. '+error.message,true);
        }
      } else {
        if (!result.item) throw Error('Save confirmed but the returned product is missing. Refresh inventory.');
        const item=result.item;
        if (job.sentPayload.id) revisions.set(key(item.ID,job.sentPayload.expectedUpdatedAt),item.UpdatedAt);
        job.status='done';applyConfirmedItem(item);
      }
    } catch(error) {
      const message=error?.message || 'Unknown save error.';
      if (!confirmed && /timed out|network|fetch|connection/i.test(message)) {
        job.status='uncertain';paused=true;
        job.error='The save may already exist in Sheets. Use Check / retry same request to safely resend the same request ID. Do not enter this change again.';
        notify('Queue paused: a save could not be confirmed. Open the bottom bar.',true);
      } else {
        job.status='failed';job.error=message;
        blockDependents(job,'A previous change to this product failed. Refresh and re-enter this change after resolving the issue.');
        notify('A queued transaction needs attention. Open the bottom bar.',true);
      }
    } finally {
      running=false;renderQueue(true);
      if (!paused) queueMicrotask(worker);
    }
  }

  // Replace the original synchronous-feeling commit. Existing form validation
  // stays intact. The dialog closes before any network operation begins.
  commit = function enqueueTransaction(payload) {
    if (!state.live || state.busy) {
      $('formError').textContent='Wait for the current inventory read to finish, then try again.';
      return;
    }
    const id=crypto.randomUUID();
    const job={id,payload:{...payload,requestId:id},description:description(payload),
      status:'waiting',error:'',time:new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})};
    jobs.push(job);
    $('confirmation').close();$('editor').close();$('formError').textContent='';
    // Native modal focus restoration can vary; use the original saved focus.
    if (typeof returnFocus !== 'undefined') returnFocus?.focus();
    clearTimeout(hideTimer);
    renderQueue(true);
    // Yield so the browser can paint the closed dialog before starting the POST.
    setTimeout(worker,0);
  };

  const originalLoad=load;
  load=async function queuedSafeLoad() {
    if (active().length || paused) {
      notify('Inventory refresh is available when the queue finishes. Confirmed saves update quantities automatically.');
      return;
    }
    return originalLoad();
  };
  $('refresh').onclick=()=>load();
  const originalLoadHistory=loadHistory;
  loadHistory=async function queuedSafeHistory(reset=false) {
    if (active().length || paused) {
      $('transactions').innerHTML='<p class="empty">Transactions are saving. Refresh history when the queue finishes.</p>';
      return;
    }
    return originalLoadHistory(reset);
  };

  el('queueBar').onclick=()=>{
    focusBeforeQueue=document.activeElement;
    renderQueue();el('queueDialog').showModal();
  };
  function closeQueue(){el('queueDialog').close();if(!el('queueBar').hidden)focusBeforeQueue?.focus();}
  el('queueClose').onclick=closeQueue;
  el('queueClear').onclick=()=>{
    for(let i=jobs.length-1;i>=0;i--)if(jobs[i].status==='done')jobs.splice(i,1);
    renderQueue();
  };
  el('queueItems').onclick=event=>{
    const button=event.target.closest('[data-queue-action]');if(!button)return;
    const job=jobs.find(j=>j.id===button.dataset.job);if(!job)return;
    if(button.dataset.queueAction==='dismiss' && job.status==='failed') {
      jobs.splice(jobs.indexOf(job),1);renderQueue(true);
    } else if(button.dataset.queueAction==='retry' && job.status==='uncertain' && !running) {
      // Keep the EXACT payload/request ID. Server deduplication makes this safe.
      job.status='waiting';job.error='';paused=false;renderQueue(true);worker();
    }
  };
  window.addEventListener('beforeunload',event=>{
    if(active().length || paused){event.preventDefault();event.returnValue='';}
  });
  renderQueue();
})();
