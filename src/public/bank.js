// Client-side validation and UI helpers for bank sandbox
(function () {
  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $all(sel, ctx) { return Array.from((ctx || document).querySelectorAll(sel)); }

  // Auto-hide banner into toast
  const pageBanner = $('#pageBanner');
  const toast = $('#toast');
  if (pageBanner && toast) {
    toast.textContent = pageBanner.textContent;
    toast.className = 'toast toast-visible';
    toast.setAttribute('aria-hidden', 'false');
    setTimeout(() => {
      toast.classList.remove('toast-visible');
      toast.setAttribute('aria-hidden', 'true');
    }, 4000);
    // hide banner immediately (we'll show toast)
    pageBanner.style.display = 'none';
  }

  // Simple form validation for transfer with smart amount parsing
  const transferForm = $('#transferForm');
  if (transferForm) {
    transferForm.addEventListener('submit', function (e) {
      const from = transferForm.querySelector('[name=from]').value;
      const to = transferForm.querySelector('[name=to]').value;
      // ensure user actually chose accounts (placeholder has empty value)
      if (!from || !to) {
        e.preventDefault(); showToast('Please choose both From and To accounts', 'error'); return;
      }
      let amountStr = (transferForm.querySelector('[name=amount]').value || '').trim();
      // normalize common typos: letter 'o' -> zero, remove commas and spaces
      amountStr = amountStr.replace(/o/gi, '0').replace(/[,_\s]/g, '');
      // suffix multipliers: k=thousand, m=million, b=billion
      const suffixMatch = amountStr.match(/^([0-9]*\.?[0-9]+)([kKmMbB])?$/);
      let amount = 0;
      if (suffixMatch) {
        amount = parseFloat(suffixMatch[1]);
        const s = (suffixMatch[2] || '').toLowerCase();
        if (s === 'k') amount *= 1_000;
        else if (s === 'm') amount *= 1_000_000;
        else if (s === 'b') amount *= 1_000_000_000;
      } else {
        // fallback try raw parse (handles large integers like 500000000)
        amount = parseFloat(amountStr || '0');
      }

      if (from === to) {
        e.preventDefault(); showToast('From and To accounts must be different', 'error'); return;
      }
      if (!amount || amount <= 0 || !isFinite(amount)) {
        e.preventDefault(); showToast('Amount must be a positive number (e.g. 1000, 5k, 2.5m)', 'error'); return;
      }

      // convert to cents integer to submit (avoid float issues)
      const cents = Math.round(amount * 100);
      transferForm.querySelector('[name=amount]').value = (cents/100).toFixed(2);
      // optionally attach a hidden field for cents
      let hidden = transferForm.querySelector('[name=amount_cents]');
      if (!hidden) {
        hidden = document.createElement('input');
        hidden.type = 'hidden'; hidden.name = 'amount_cents';
        transferForm.appendChild(hidden);
      }
      hidden.value = String(cents);
      // allow submit
    });
  }

  // Prevent selecting the same account in both From and To selects by rebuilding option lists
  if (transferForm) {
    const fromSelect = transferForm.querySelector('[name=from]');
    const toSelect = transferForm.querySelector('[name=to]');
    const transferBtn = transferForm.querySelector('button[type=submit]');

    // store original option templates so we can rebuild selects cleanly
    // We'll capture a single authoritative baseOptions snapshot from the server-rendered DOM.
    const baseOptions = fromSelect ? Array.from(fromSelect.options).map(o => {
      const parts = o.textContent.split(' - ').map(p => p.trim());
      return { value: o.value, text: o.textContent, owner: parts[1] || o.textContent, balance: parts[2] || '' };
    }) : [];

    // Utility: rebuild a native <select> from provided option data
    function rebuildSelect(selectElem, options) {
      // remove all existing options
      while (selectElem.firstChild) selectElem.removeChild(selectElem.firstChild);
      options.forEach(opt => {
        const o = document.createElement('option');
        o.value = opt.value; o.textContent = opt.text;
        if (opt.owner) o.dataset.owner = opt.owner;
        if (opt.balance) o.dataset.balance = opt.balance;
        if (opt.value === '') o.className = 'placeholder';
        selectElem.appendChild(o);
      });
    }

    // Deterministic sync: rebuild both selects from baseOptions while excluding the counterpart selected value.
    function syncAccountSelects() {
      if (!fromSelect || !toSelect) return;
      const fromVal = fromSelect.value;
      const toVal = toSelect.value;

      // Build option lists by filtering the base snapshot.
      // Only exclude the counterpart's selected id when that id is non-empty.
      const fromOptions = baseOptions.filter(o => (toVal ? o.value !== toVal : true));
      const toOptions = baseOptions.filter(o => (fromVal ? o.value !== fromVal : true));

      // Count only real account options (value !== '') to decide placeholder behavior
      const fromRealCount = fromOptions.filter(o => o.value !== '').length;
      const toRealCount = toOptions.filter(o => o.value !== '').length;
      const visibleReal = Math.max(fromRealCount, toRealCount);

      // If both selects are currently unselected (placeholders), preserve the placeholder at top so
      // the UI doesn't auto-select the first account. Otherwise ensure placeholder exists if there
      // are fewer than 2 real accounts.
      const placeholder = { value: '', text: 'Choose account', owner: 'Choose account', balance: '' };
      let finalFrom, finalTo;
      if (!fromVal && !toVal) {
        finalFrom = baseOptions.slice(); finalTo = baseOptions.slice();
      } else {
        finalFrom = fromOptions.slice();
        finalTo = toOptions.slice();
        if (visibleReal < 2) {
          // ensure placeholder at top
          if (!finalFrom.some(o => o.value === '')) finalFrom.unshift(placeholder);
          if (!finalTo.some(o => o.value === '')) finalTo.unshift(placeholder);
        }
      }

      // Rebuild native selects first (authoritative source for form submission)
      rebuildSelect(fromSelect, finalFrom);
      rebuildSelect(toSelect, finalTo);

      // Restore previous selection if still present; else pick first non-empty
      if (fromVal && Array.from(fromSelect.options).some(o => o.value === fromVal)) fromSelect.value = fromVal;
      else if (fromSelect.options.length > 0) fromSelect.selectedIndex = 0;

      if (toVal && Array.from(toSelect.options).some(o => o.value === toVal)) toSelect.value = toVal;
      else if (toSelect.options.length > 0) toSelect.selectedIndex = 0;

      // apply placeholder styling classes
      if (fromSelect.value === '') fromSelect.classList.add('has-placeholder'); else fromSelect.classList.remove('has-placeholder');
      if (toSelect.value === '') toSelect.classList.add('has-placeholder'); else toSelect.classList.remove('has-placeholder');

      // disable transfer when fewer than two accounts available
      try { if (transferBtn) transferBtn.disabled = visibleCount < 2; } catch (e) {}

      // Now update any custom dropdown UI that mirrors the native selects
      const updateCustomFromNative = (sel) => {
        const wrapper = sel.nextSibling;
        if (!wrapper || !wrapper.classList || !wrapper.classList.contains('custom-select')) return;
        const label = wrapper.querySelector('.cs-label');
        const bal = wrapper.querySelector('.cs-balance');
        const list = wrapper.querySelector('.cs-list');
        const cur = sel.options[sel.selectedIndex];
        label.textContent = cur ? (cur.dataset.owner || cur.textContent) : 'Choose account';
        bal.textContent = cur ? (cur.dataset.balance || '') : '';
        // rebuild list from current select options
        list.innerHTML = '';
        const opts = Array.from(sel.options).map(o => ({ value: o.value, owner: o.dataset.owner || o.textContent, balance: o.dataset.balance || '' }));
        if (!opts.length) {
          const e = document.createElement('div'); e.className = 'cs-empty'; e.textContent = 'No accounts'; list.appendChild(e);
        } else {
          opts.forEach(opt => {
            const item = document.createElement('div'); item.className = 'cs-item';
            const owner = document.createElement('div'); owner.className = 'owner'; owner.textContent = opt.owner;
            const balance = document.createElement('div'); balance.className = 'bal'; balance.textContent = opt.balance;
            item.appendChild(owner); item.appendChild(balance);
            item.dataset.value = opt.value;
            item.addEventListener('click', () => {
              sel.value = opt.value;
              const ev = new Event('change', { bubbles: true }); sel.dispatchEvent(ev);
              wrapper.classList.remove('open');
            });
            list.appendChild(item);
          });
        }
      };
      try { updateCustomFromNative(fromSelect); updateCustomFromNative(toSelect); } catch (e) {}
    }

    if (fromSelect) fromSelect.addEventListener('change', syncAccountSelects);
    if (toSelect) toSelect.addEventListener('change', syncAccountSelects);
    // initial sync on page load
    syncAccountSelects();
  }

  // Confirm reset
  const resetForm = $('#resetForm');
  if (resetForm) {
    resetForm.addEventListener('submit', function (e) {
      const ok = window.confirm('Reset your sandbox? This will delete all accounts and transactions for your session.');
      if (!ok) e.preventDefault();
    });
  }

  // Accounts pagination (client-side): show 5 rows per page
  const accountsTbody = $('#accountsTbody');
  const pager = $('#accountsPager');
  if (accountsTbody && pager) {
    const rows = Array.from(accountsTbody.querySelectorAll('tr'));
    const perPage = 5;
    let page = 0;
    const totalPages = Math.max(1, Math.ceil(rows.length / perPage));

    const prevBtn = $('#accountsPrev');
    const nextBtn = $('#accountsNext');
    const indicator = $('#accountsPageIndicator');

    function renderPage() {
      const start = page * perPage;
      const end = start + perPage;
      rows.forEach((r, i) => {
        r.style.display = (i >= start && i < end) ? '' : 'none';
      });
      indicator.textContent = `${page + 1} / ${totalPages}`;
      prevBtn.disabled = page === 0;
      nextBtn.disabled = page === totalPages - 1;
      pager.setAttribute('aria-hidden', totalPages <= 1 ? 'true' : 'false');
    }

    prevBtn.addEventListener('click', () => { if (page > 0) { page--; renderPage(); } });
    nextBtn.addEventListener('click', () => { if (page < totalPages - 1) { page++; renderPage(); } });

    renderPage();
  }

  // Transactions pagination (client-side): show 5 rows per page
  const txTbody = $('#txTbody');
  const txPager = $('#txPager');
  if (txTbody && txPager) {
    const rows = Array.from(txTbody.querySelectorAll('tr'));
    const perPage = 5;
    let page = 0;
    const totalPages = Math.max(1, Math.ceil(rows.length / perPage));

    const prevBtn = $('#txPrev');
    const nextBtn = $('#txNext');
    const indicator = $('#txPageIndicator');

    function renderTxPage() {
      const start = page * perPage;
      const end = start + perPage;
      rows.forEach((r, i) => {
        r.style.display = (i >= start && i < end) ? '' : 'none';
      });
      indicator.textContent = `${page + 1} / ${totalPages}`;
      prevBtn.disabled = page === 0;
      nextBtn.disabled = page === totalPages - 1;
      txPager.setAttribute('aria-hidden', totalPages <= 1 ? 'true' : 'false');
    }

    prevBtn.addEventListener('click', () => { if (page > 0) { page--; renderTxPage(); } });
    nextBtn.addEventListener('click', () => { if (page < totalPages - 1) { page++; renderTxPage(); } });

    renderTxPage();
  }

  // Create account validation
  const createForm = $('#createAccountForm');
  if (createForm) {
    createForm.addEventListener('submit', function (e) {
      let owner = createForm.querySelector('[name=owner]').value.trim();
      const balanceRaw = createForm.querySelector('[name=balance]').value || '0';
      // enforce allowed characters for owner (letters, spaces, hyphen, apostrophe)
      owner = owner.replace(/[^A-Za-z\-' ]+/g, '');
      createForm.querySelector('[name=owner]').value = owner;

      // parse balance similar to transfer input
      let b = ('' + balanceRaw).replace(/o/gi, '0').replace(/[,_\s]/g, '');
      const suff = b.match(/^([0-9]*\.?[0-9]+)([kKmMbB])?$/);
      let balance = 0;
      if (suff) {
        balance = parseFloat(suff[1]);
        const s = (suff[2] || '').toLowerCase();
        if (s === 'k') balance *= 1_000;
        else if (s === 'm') balance *= 1_000_000;
        else if (s === 'b') balance *= 1_000_000_000;
      } else {
        balance = parseFloat(b || '0');
      }

      if (!owner) { e.preventDefault(); showToast('Owner name required', 'error'); return; }
      if (isNaN(balance) || !isFinite(balance)) { e.preventDefault(); showToast('Initial balance must be a number', 'error'); return; }
      createForm.querySelector('[name=balance]').value = balance.toFixed(2);
    });
  }

// helper to map status to a light background color for the badge
function _statusColor(status) {
  const s = (status || '').toLowerCase();
  if (s === 'active') return '#d4edda';
  if (s === 'debit freeze' || s === 'credit freeze') return '#fff3cd';
  if (s === 'total freeze') return '#f8d7da';
  if (s === 'dormant' || s === 'inactive') return '#e2e3e5';
  return '#e9ecef';
}

// attach event handlers to status dropdowns to send AJAX updates
function _bindStatusControls() {
  const selects = Array.from(document.querySelectorAll('.status-select'));
  selects.forEach(sel => {
    sel.addEventListener('change', async (ev) => {
      const accountId = sel.dataset.accountId;
      const newStatus = sel.value;
      try {
        const res = await fetch(`/bank/accounts/${accountId}/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: newStatus })
        });
        if (!res.ok) throw new Error('Update failed');
        const json = await res.json();
        // update adjacent badge text and color
        const badge = sel.parentElement.querySelector('.status-badge');
        if (badge) {
          badge.textContent = newStatus;
          badge.style.background = _statusColor(newStatus);
        }
      } catch (e) {
        showToast && showToast('Failed to update status', 'error');
        // revert selection visually? (reload page to be safe)
        setTimeout(() => window.location.reload(), 800);
      }
    });
    // initial color
    const badge = sel.parentElement.querySelector('.status-badge');
    if (badge) badge.style.background = _statusColor(sel.value || badge.textContent);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  _bindStatusControls();
});

  function showToast(message, type) {
    if (!toast) return alert(message);
    toast.textContent = message;
    toast.className = 'toast toast-visible ' + (type === 'error' ? 'toast-error' : 'toast-success');
    toast.setAttribute('aria-hidden', 'false');
    setTimeout(() => {
      toast.classList.remove('toast-visible');
      toast.setAttribute('aria-hidden', 'true');
    }, 4000);
  }

  // --- Custom dropdown helper ---
  function makeCustomDropdown(selectElem) {
    // hide native select but keep it for form submission
    selectElem.style.display = 'none';
    const wrapper = document.createElement('div');
    wrapper.className = 'custom-select';

    const trigger = document.createElement('div'); trigger.className = 'cs-trigger';
    const label = document.createElement('div'); label.className = 'cs-label muted';
    const bal = document.createElement('div'); bal.className = 'cs-balance muted';
    trigger.appendChild(label); trigger.appendChild(bal);

    const list = document.createElement('div'); list.className = 'cs-list';

    // build items from select options
    const opts = Array.from(selectElem.options).map(o => ({ value: o.value, owner: o.dataset.owner || o.textContent, balance: o.dataset.balance || '' }));

    function rebuild() {
      // clear list
      list.innerHTML = '';
      if (!opts.length) {
        const e = document.createElement('div'); e.className = 'cs-empty'; e.textContent = 'No accounts'; list.appendChild(e); return;
      }
      opts.forEach(opt => {
        const item = document.createElement('div'); item.className = 'cs-item';
        const owner = document.createElement('div'); owner.className = 'owner'; owner.textContent = opt.owner;
        const balance = document.createElement('div'); balance.className = 'bal'; balance.textContent = opt.balance;
        item.appendChild(owner); item.appendChild(balance);
        item.dataset.value = opt.value;
        item.addEventListener('click', () => {
          selectElem.value = opt.value;
          label.textContent = opt.owner;
          bal.textContent = opt.balance;
          wrapper.classList.remove('open');
          // trigger change for other sync logic
          const ev = new Event('change', { bubbles: true }); selectElem.dispatchEvent(ev);
        });
        list.appendChild(item);
      });
    }

    // initial selection
    const cur = selectElem.options[selectElem.selectedIndex];
    label.textContent = cur ? (cur.dataset.owner || cur.textContent) : 'Choose account';
    bal.textContent = cur ? (cur.dataset.balance || '') : '';

    trigger.addEventListener('click', () => wrapper.classList.toggle('open'));

    wrapper.appendChild(trigger); wrapper.appendChild(list);
    selectElem.parentNode.insertBefore(wrapper, selectElem.nextSibling);

    // Rebuild initially
    rebuild();

    // when native select changes externally (we rebuild on reinserts), update trigger
    selectElem.addEventListener('change', () => {
      const cur2 = selectElem.options[selectElem.selectedIndex];
      label.textContent = cur2 ? (cur2.dataset.owner || cur2.textContent) : 'Choose account';
      bal.textContent = cur2 ? (cur2.dataset.balance || '') : '';
      // rebuild option list from DOM options (keeps parity)
      const newOpts = Array.from(selectElem.options).map(o => ({ value: o.value, owner: o.dataset.owner || o.textContent, balance: o.dataset.balance || '' }));
      opts.length = 0; newOpts.forEach(n => opts.push(n)); rebuild();
    });
    return wrapper;
  }

  // Transform account-selects into custom dropdowns
  $all('.account-select').forEach(s => { try { makeCustomDropdown(s); } catch (e) {} });

  // Sync again after custom dropdowns are created so labels/lists reflect any earlier select rebuilds
  try {
    if (typeof syncAccountSelects === 'function') syncAccountSelects();
    $all('.account-select').forEach(s => s.dispatchEvent(new Event('change')));
  } catch (e) {}

})();
