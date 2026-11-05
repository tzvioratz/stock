# Verification and deployment acceptance

## Local automated checks

Run from this directory:

```sh
node --check script.js
node --check < Code.gs
node smoke-tests.js
```

Result at packaging: both JavaScript syntax checks passed; 22 mocked logic tests passed.

The tests execute the actual backend functions against in-memory Google service doubles and the actual CSV parser. They cover:

1. Add product and paired inventory/history write.
2. Home-to-truck transfer and unchanged total.
3. Durable request-ID deduplication.
4. Overselling rejection with no write.
5. Same-location transfer rejection.
6. Zero, negative and fractional transfers.
7. Stale revision rejection.
8. Actual count adjustment and signed history delta.
9. Negative count rejection.
10. Case-insensitive duplicate SKUs.
11. Unknown product and action rejection.
12. Metadata edit without quantity changes.
13. Literal-string cell serialization against formula injection.
14. Failed batch leaves both tables unchanged and releases lock in the simulation.
15. Archive hides active inventory while preserving counts and history.
16. Archived SKU reservation.
17. Newest-first history, pagination and ID search.
18. Exact iframe destination origin validation.
19. Safe JSON escaping inside script responses.
20. CSV commas and escaped quotes using the sample file.
21. CSV BOM, multiline fields and empty numeric cells.
22. Invalid headers, negative numeric cells and unclosed CSV quotes.

These are not live integration or browser layout tests. The doubles assume the documented Sheets batch atomicity; they do not prove Google service behavior, latency, quotas or iframe response delivery. No deployment to a Google account was performed in creating this package.

## Manual acceptance checklist — run before real use

- [ ] Run setup and verify the three exact schemas and the advanced Sheets service.
- [ ] Open the published CSV signed out. Confirm only Inventory is published.
- [ ] Open /exec?action=getInventory signed out and see ok:true.
- [ ] Serve the frontend over HTTPS and configure the exact host origin.
- [ ] Verify CSV loading, then live status, on both desktop and a real phone.
- [ ] Add a product with 15 at home and 4 in truck. Confirm dashboard total 19.
- [ ] Move 6 Home to Truck. Confirm Home 9, Truck 10, total 19 and one transaction.
- [ ] Move back from Truck to Home and confirm both columns update together.
- [ ] Attempt more than available, negative counts and a duplicate SKU. Verify rejection.
- [ ] Adjust truck quantity to 6. Inspect previous/new JSON snapshots and signed delta.
- [ ] Edit name, SKU, notes and threshold. Confirm search and status update.
- [ ] Open the same product in two browser tabs. Save from one; save stale data from the other. Confirm conflict rejection and no lost update.
- [ ] Archive via confirmation; verify quantities disappear from active totals but old history remains.
- [ ] Search history for an old product ID and load multiple pages.
- [ ] Test empty inventory, no matches, out-of-stock and exact reorder boundary.
- [ ] Navigate dialogs by keyboard. Check focus return, Escape, labels and scrolling at phone widths.
- [ ] Turn off networking during reads/saves. Confirm visible errors, no false success, and disabled unsafe edits.
- [ ] With a save timeout, refresh and inspect history before resubmitting.
- [ ] Set ENABLE_PUBLIC_WRITES=false; verify a save is visibly rejected.
- [ ] Review public-write risks and take a spreadsheet backup before operational use.
