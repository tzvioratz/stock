/* Load as a classic deferred script AFTER every existing Stockline add-on. */
'use strict';
(() => {
  const price=value=>{
    const n=Number(value??0);
    return Number.isFinite(n)&&n>=0?n.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}):'—';
  };
  const previousRender=render;
  render=function renderInventoryWithPrices(){
    previousRender();
    const byId=new Map(state.items.map(p=>[String(p.ID),p]));
    $('products').querySelectorAll('.product').forEach(card=>{
      const id=card.querySelector('[data-id]')?.dataset.id;
      const item=byId.get(String(id));if(!item)return;
      const area=document.createElement('div');area.className='product-prices';
      area.innerHTML='<span>Cost <b>'+esc(price(item.CostPrice))+'</b></span><span>Retail <b>'+esc(price(item.RetailPrice))+'</b></span>';
      card.firstElementChild.append(area);
    });
  };
  const previousOpenEditor=openEditor;
  openEditor=function openEditorWithPrices(action,id){
    previousOpenEditor(action,id);
    if(!$('editor').open||!['addItem','editItem'].includes(action))return;
    if($('fields').querySelector('[name="CostPrice"]'))return;
    const item=state.items.find(p=>p.ID===id)||{};
    const pair=document.createElement('div');pair.className='pair price-fields';
    pair.innerHTML=[['Cost price','CostPrice'],['Retail price','RetailPrice']].map(([label,name])=>`<label>${label}<input name="${name}" type="number" min="0" max="1000000000" step="0.01" inputmode="decimal" required value="${esc(Number(item[name]??0).toFixed(2))}"></label>`).join('');
    $('fields').append(pair);
  };
  // Validate in capture phase before the original form's submit listener queues it.
  $('editorForm').addEventListener('submit',event=>{
    if(!['addItem','editItem'].includes(mode))return;
    for(const [name,label] of [['CostPrice','Cost price'],['RetailPrice','Retail price']]){
      const input=$('fields').querySelector('[name="'+name+'"]');if(!input)continue;
      const raw=input.value.trim();const n=Number(raw);
      if(!/^\d+(?:\.\d{1,2})?$/.test(raw)||!Number.isFinite(n)||n<0||n>1000000000){
        event.preventDefault();event.stopImmediatePropagation();
        $('formError').textContent=label+' must be between 0 and 1,000,000,000 with at most two decimal places.';input.focus();return;
      }
    }
  },true);
  // Original search handlers may point at earlier render functions; use latest.
  $('search').oninput=()=>render();$('filter').onchange=()=>render();
  const category=document.getElementById('categoryFilter');if(category)category.onchange=()=>render();
  const sort=document.getElementById('inventorySort');if(sort)sort.onchange=()=>render();
  render();
})();
