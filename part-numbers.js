/* Load LAST, as a classic deferred script. Requires documented backend patches. */
'use strict';
(() => {
  const previousOpenEditor = openEditor;
  openEditor = function openEditorWithPartNumber(action, id) {
    if (!state.live || state.busy) return;
    previousOpenEditor(action, id);
    const fields = $('fields');
    fields.classList.toggle('part-number-add-mode', action === 'addItem');
    if (!$('editor').open || !['addItem', 'editItem'].includes(action)) return;
    const item = state.items.find(p => String(p.ID) === String(id)) || {};
    if (!fields.querySelector('[name="PartNumber"]')) {
      const label = document.createElement('label');
      label.innerHTML = 'Part number<input name="PartNumber" type="text" maxlength="80" autocomplete="off" spellcheck="false" value="' + esc(item.PartNumber || '') + '">';
      const nameLabel = fields.querySelector('[name="Name"]')?.closest('label');
      if (nameLabel) nameLabel.after(label); else fields.prepend(label);
    }
    const sku = fields.querySelector('input[name="SKU"]');
    if (sku && action === 'addItem') {
      sku.classList.add('part-number-hidden-sku');
      const label = sku.closest('label');
      if (label) {
        const firstText = [...label.childNodes].find(node => node.nodeType === 3 && node.textContent.trim());
        if (firstText) firstText.textContent = 'Barcode (optional)';
        const note = document.createElement('small');
        note.className = 'muted';
        note.textContent = 'Scan to attach a barcode or find an existing item. View or change its SKU in Edit.';
        label.append(note);
      }
    } else if (sku) {
      sku.classList.remove('part-number-hidden-sku');
    }
  };
})();
