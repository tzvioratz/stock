/* Load AFTER script.js and queue.js, as a classic deferred script. */
'use strict';
(() => {
  const defaults=[];
  const toolbar=$('inventoryView').querySelector('.toolbar');
  const categoryLabel=document.createElement('label');
  categoryLabel.innerHTML='Category<select id="categoryFilter"><option value="">All categories</option></select>';
  toolbar.insertBefore(categoryLabel,$('filter').parentElement);
  const sortLabel=document.createElement('label');
  sortLabel.innerHTML=`Sort by<select id="inventorySort"><option value="nameAsc">Name: A–Z</option><option value="nameDesc">Name: Z–A</option><option value="stockUrgent">Stock: out → low → in stock</option><option value="stockHealthy">Stock: in stock → low → out</option><option value="category">Category: A–Z</option></select>`;
  toolbar.append(sortLabel);
  const canonical=value=>{
    const trimmed=String(value||'').trim();
    return defaults.find(v=>v.toLowerCase()===trimmed.toLowerCase())||trimmed;
  };
  const categoryOf=p=>canonical(p.Category);
  const compare=(a,b)=>String(a).localeCompare(String(b),undefined,{numeric:true,sensitivity:'base'});
  function categories(){
    const values=new Map();
    defaults.forEach(v=>values.set(v.toLowerCase(),v));
    state.items.forEach(p=>{const value=categoryOf(p);if(!values.has(value.toLowerCase()))values.set(value.toLowerCase(),value);});
    return [...values.values()].sort(compare);
  }
  function rank(p){const total=p.HomeQty+p.TruckQty;return total===0?0:total<=p.ReorderLevel?1:2;}
  function sortProducts(items,sort){
    return [...items].sort((a,b)=>{
      let primary=0;
      if(sort==='nameDesc')primary=compare(b.Name,a.Name);
      else if(sort==='category')primary=compare(categoryOf(a),categoryOf(b));
      else if(sort==='stockUrgent')primary=rank(a)-rank(b);
      else if(sort==='stockHealthy')primary=rank(b)-rank(a);
      else primary=compare(a.Name,b.Name);
      return primary||compare(a.Name,b.Name)||compare(a.ID,b.ID);
    });
  }
  render=function renderCategorizedInventory(){
    const items=state.items;
    const filter=$('categoryFilter');const chosen=filter.value;
    const options=categories();
    // Preserve a selected category even if its last item was archived or renamed.
    if(chosen&&!options.some(v=>v.toLowerCase()===chosen.toLowerCase()))options.push(chosen);
    filter.innerHTML='<option value="">All categories</option>'+options.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');
    filter.value=chosen;
    $('home').textContent=fmt(items.reduce((s,p)=>s+p.HomeQty,0));
    $('car').textContent=fmt(items.reduce((s,p)=>s+p.TruckQty,0));
    $('total').textContent=fmt(items.reduce((s,p)=>s+p.HomeQty+p.TruckQty,0));
    $('low').textContent=fmt(items.filter(p=>p.HomeQty+p.TruckQty<=p.ReorderLevel).length);
    const q=$('search').value.trim().toLowerCase(),f=$('filter').value;
    const matches=items.filter(p=>!chosen||categoryOf(p).toLowerCase()===chosen.toLowerCase())
    .filter(p=>[p.Name,p.PartNumber,p.SKU,p.Notes,categoryOf(p)].join(' ').toLowerCase().includes(q))
    .filter(p=>f==='all'||f==='home'&&p.HomeQty>0||f==='car'&&p.TruckQty>0||f==='low'&&p.HomeQty+p.TruckQty<=p.ReorderLevel||f==='out'&&p.HomeQty+p.TruckQty===0);
    const visible=sortProducts(matches,$('inventorySort').value);
    $('count').textContent='('+visible.length+')';
    $('products').innerHTML=visible.map(p=>{
      const [cls,label]=status(p);
      return `<article class="product"><div><h3><button type="button" class="item-stock-button" data-stock-id="${esc(p.ID)}" aria-label="Add or remove inventory for ${esc(p.Name)}">${esc(p.Name)}</button></h3><p class="muted">${esc(p.PartNumber||'No part number')}</p><span class="product-category">${esc(categoryOf(p))}</span>${p.Notes?`<p class="muted">${esc(p.Notes)}</p>`:''}</div><div class="quantities"><div><span>HOME</span><b>${fmt(p.HomeQty)}</b></div><div><span>CAR</span><b>${fmt(p.TruckQty)}</b></div><div><span>TOTAL</span><b>${fmt(p.HomeQty+p.TruckQty)}</b></div></div><span class="badge ${cls}">${label}</span><div class="actions">${[['transfer','Move'],['adjust','Adjust'],['editItem','Edit']].map(([action,text])=>`<button class="secondary" data-action="${action}" data-id="${esc(p.ID)}" aria-label="${text} ${esc(p.Name)}" ${!state.live||state.busy?'disabled':''}>${text}</button>`).join('')}</div></article>`;
    }).join('')||`<p class="empty">${items.length?'No products match your search or filters.':'Your inventory is empty. Add your first item to get started.'}</p>`;
  };
  const originalOpenEditor=openEditor;
  openEditor=function openCategorizedEditor(action,id){
    originalOpenEditor(action,id);
    if(!$('editor').open||!['addItem','editItem'].includes(action))return;
    const product=state.items.find(p=>p.ID===id);
    const label=document.createElement('label');
    label.innerHTML=`Category<input name="Category" list="categorySuggestions" maxlength="80" value="${esc(categoryOf(product||{}))}" placeholder="Choose or type a category" required><datalist id="categorySuggestions">${categories().map(v=>`<option value="${esc(v)}"></option>`).join('')}</datalist><small class="category-help">Choose a suggestion or type a new category.</small>`;
    $('fields').insertBefore(label,$('fields').querySelector('[name=Notes]').parentElement);
    label.querySelector('input').addEventListener('change',event=>{
      const entered=event.target.value.trim();
      event.target.value=categories().find(v=>v.toLowerCase()===entered.toLowerCase())||canonical(entered);
    });
  };
  // The original form submits all named fields, including the injected Category.
  // Existing queue payload forwarding and server-confirmed rendering stay intact.
  $('search').oninput=()=>render();$('filter').onchange=()=>render();
  $('categoryFilter').onchange=()=>render();$('inventorySort').onchange=()=>render();
  // Original listeners look up openEditor/ render at execution time.
  render();
})();
