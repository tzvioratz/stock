# Stockline — Home & Truck Inventory

A responsive, framework-free inventory application for a small operation. Static HTML/CSS/JavaScript runs on GitHub Pages; Google Sheets holds inventory and history; Google Apps Script validates and commits changes.

## Package contents

- `index.html` — accessible dashboard, inventory, history and dialogs.
- `style.css` — mobile product cards, desktop layout, status colors.
- `script.js` — public URL configuration, CSV parser, API transport and UI.
- `Code.gs` — complete Apps Script backend and non-destructive setup.
- `appsscript.json` — optional Apps Script manifest enabling advanced Sheets service.
- `sample-inventory.csv` — sample products; includes commas and escaped quotes.
- `smoke-tests.js` — dependency-free local automated checks, run with Node.js.
- `TESTS.md` — automated test results and manual deployment acceptance checklist.

No bundler, npm dependencies, framework, private credential, or paid service is required. A modern browser with native dialog, fetch, crypto.randomUUID and AbortSignal.timeout support is expected. This is an online app, not an offline inventory system.

## 1. Security decision — read before deploying

This requested architecture is a PUBLIC-DATA / PUBLIC-WRITE demonstration suitable only when public access and potential unauthorized changes are acceptable. It is not a private business inventory system merely because its URL is hard to guess.

Publishing Inventory as CSV exposes EVERY published column: notes, quantities, archived rows, timestamps, SKUs and IDs. Publish only non-sensitive information. Do not publish Transactions or Settings. Nevertheless, the public Apps Script read endpoints expose active inventory and transaction history; treat the entire history, including adjustment reasons, as public too.

Deployment as “Anyone”, executing as you, allows anyone who can reach the endpoint to use the backend with your spreadsheet permissions. Writes start disabled. Enabling ENABLE_PUBLIC_WRITES explicitly accepts this tradeoff. ALLOWED_ORIGINS controls the iframe response destination; it is NOT authentication or protection against direct HTTP clients, bots or CSRF. An attacker can forge clientOrigin or call the JSON endpoint directly. Locks, validation, idempotency and atomic batches protect data consistency, not authorization or service abuse. A public attacker could change valid inventory, archive items or consume your Apps Script quotas.

For real private inventory: do not publish CSV; replace public CSV/JSONP reads with authenticated reads, and put writes behind an authenticated backend with server-side user authorization, CSRF protections where appropriate, and rate limiting. Restrict Apps Script access appropriately or host a same-origin UI in Apps Script with an authenticated deployment and `google.script.run`. Simply changing this deployment to “Only myself” or a restricted Workspace audience does not make this cross-origin GitHub Pages transport work reliably: the browser can be redirected to sign-in or blocked in an iframe. That private deployment requires an authentication/transport redesign, not a frontend password. Do not put shared secrets in JavaScript, Settings, URLs or localStorage.

Keep the spreadsheet sharing permissions restricted to trusted owners/editors. Public CSV publishing does not require granting spreadsheet edit access. Protect both tab schemas and discourage direct sheet edits. All application users should write through the same Apps Script project. ScriptLock cannot stop manual edits, a different Apps Script project, or another Sheets API client.

## 2. Create the Google Sheet and Apps Script project

1. Create a new Google spreadsheet, optionally named “Stockline Inventory”.
2. Open Extensions → Apps Script. Replace default Code.gs with the provided Code.gs.
3. In the Apps Script editor, next to Services, click + and add **Google Sheets API** (v4, identifier `Sheets`). If using your own standard Google Cloud project, also enable Google Sheets API in its Cloud console. The default Apps Script cloud project normally handles this when the service is added.
4. Optional alternative: in Project Settings enable “Show appsscript.json manifest file”, and merge the supplied manifest into yours. Do not remove existing dependencies in a project you are reusing. The service identifier must remain `Sheets`.
5. Run `setup` from the function selector. Authorize the script as the spreadsheet owner. If your own unverified project shows an authorization warning, verify it is YOUR script and inspect its permissions before continuing. Do not bypass an organization policy.
6. Setup creates Inventory, Transactions and Settings, adds headers, freezes the header row, and stores the spreadsheet ID in server-only Script Properties. It does not erase existing rows. Incorrect existing headers cause an error rather than data loss.
7. For a standalone rather than sheet-bound script, set SPREADSHEET_ID under Project Settings → Script Properties before running setup. Find that ID in the spreadsheet URL between `/d/` and `/edit`. Never paste it into frontend code.
8. Review Settings. ApplicationName and DefaultReorderLevel are extension points; the current frontend defaults reorder to 0. SpreadsheetID there is convenience metadata only; Script Properties are authoritative. Do not store secrets in Settings.

### Required schemas

Inventory, A:J:

| Column | Header |
|---|---|
| A | ID |
| B | Name |
| C | SKU |
| D | HomeQty |
| E | TruckQty |
| F | ReorderLevel |
| G | Notes |
| H | Active |
| I | CreatedAt |
| J | UpdatedAt |

Transactions, A:K:

`TransactionID, Timestamp, ProductID, ProductName, Action, Quantity, FromLocation, ToLocation, PreviousQty, NewQty, Notes`

Settings, A:B: `Key, Value`.

Do not rename, reorder or insert columns inside these schemas. All quantities are whole units from 0 through 1,000,000,000 per location; totals can exceed that per-location limit. IDs are UUIDs, never names. Empty SKUs are permitted; nonempty SKUs must be unique case-insensitively, including archived rows.

### Optional sample data

After setup, import sample-inventory.csv into the Inventory tab using File → Import → Upload → Replace current sheet (NOT replace spreadsheet), or paste its data rows below the existing headers. Keep the tab named Inventory and preserve all other tabs. Import SKUs and IDs as text if prompted. ISO timestamp strings are recommended; actual Sheet Date values are also supported and normalized. Sample rows do not create historical transactions; for fully audited initial quantities, use Add item instead. Once initialized, use the app rather than manual sheet edits.

## 3. Publish ONLY Inventory as CSV

1. Open the spreadsheet and choose File → Share → Publish to web.
2. Select the specific **Inventory** sheet, not “Entire document”.
3. Select “Comma-separated values (.csv)” as the format, then Publish.
4. In published content/settings, enable automatic republishing when changes are made.
5. Copy the generated published URL. It usually contains `/spreadsheets/d/e/.../pub?gid=...&single=true&output=csv`. Use the generated URL rather than assembling one from the normal edit URL.
6. Open it while signed out to confirm it returns CSV with the exact Inventory headers. Account/Workspace policies can disable public publishing.
7. Set `CSV_URL` at the top of script.js to that URL.

### CSV caching and refresh strategy

Google says published changes can take a few minutes to appear. Cache-busting parameters and fetch cache:'no-store' bypass ordinary browser caches but CANNOT guarantee bypassing Google's publication cache.

The app fetches CSV on first page load as a read-only preview, then reconciles it with getInventory from the live backend. Editing stays disabled until a live read succeeds. Later refreshes use the live API only, so stale CSV never overwrites live quantities. A confirmed save first applies the returned authoritative item in memory, then reads a fresh backend snapshot. If live reads fail, a cached view stays clearly labeled and editing is disabled; if CSV alone fails, a successful live API read still lets you work and displays the CSV warning. The CSV is not a backup of history.

There is no background polling: another user's changes appear when you refresh. Concurrent conflicting edits are rejected by UpdatedAt checks and can then be retried after refreshing.

## 4. Configure and deploy the backend

1. Project Settings → Script Properties: verify `SPREADSHEET_ID` was saved by setup.
2. Set `ALLOWED_ORIGINS` to your static site's exact origin, e.g. `https://YOURNAME.github.io`. Do NOT include `/repository-name`, a trailing slash, or a page path. A comma-separated list supports multiple hosts, e.g. `https://YOURNAME.github.io,http://localhost:8000`. For a custom domain, list its exact HTTPS origin as well.
3. Only after accepting the public-write risks, set `ENABLE_PUBLIC_WRITES` to the literal lowercase string `true`. Set it to `false` anytime to disable writes immediately without redeploying.
4. Deploy → New deployment → select type Web app.
5. Execute as: **Me** (the trusted owner). Who has access: **Anyone**, including anonymous users. If the choice is unavailable, your account policy is incompatible with this public architecture; use an approved authenticated alternative.
6. Deploy and copy the final `/exec` URL into `API_URL` in script.js. Do not use `/dev`, which is for editor testing.
7. Visit `YOUR_EXEC_URL?action=getInventory` in a browser. You should see JSON with `ok:true` and an `items` array, possibly empty. If HTML sign-in appears, fix deployment access. The endpoint never needs the spreadsheet ID in its URL.
8. When Code.gs changes, use Deploy → Manage deployments → edit → select **New version** → Deploy. Editing a source file alone does not update an existing versioned web deployment. Update API_URL if creating a different deployment.

### How static hosting communicates with Apps Script

Apps Script ContentService redirects and cross-origin behavior make naive application/json fetch writes problematic. This app does not use an unreadable `mode:'no-cors'` response or fabricate Access-Control-Allow-Origin headers.

- CSV: regular cross-origin fetch from Google's published CSV endpoint.
- API reads: GET with a strictly validated JSONP callback, returning a JSON object wrapped in that callback. Callback names are limited to `stockline_` plus 32 hex characters. No GET action mutates inventory. JSONP executes remote script: trust only your own deployment URL and never use it for private data.
- API writes: a hidden HTML form POST submits JSON in the `payload` field to a hidden iframe. doPost executes the mutation and returns a small HtmlService page with framing enabled. Its sandbox calls `window.top.postMessage` to the exact allowed static-site origin. The frontend validates the Google script origin and a random requestId before accepting the response. Errors return via the same confirmed channel.
- Other API clients: POST a JSON body directly or a form-encoded `payload`; omit transport to receive JSON rather than an iframe bridge.

Cross-site iframe execution must be allowed by the browser and network. This transport is implemented but must be smoke-tested on your actual hosted origin and phone. Content blockers, enterprise policies, sign-in redirects and Google service changes can block the frame. The app surfaces a timeout rather than claiming success. A timeout may happen AFTER the server committed: refresh and inspect history before resubmitting. Do not indiscriminately auto-retry a new transfer.

## 5. Deploy on GitHub Pages

1. Create a repository and upload index.html, style.css and your configured script.js at the repository root. Backend source and docs are optional on the public host; never upload credentials or a manifest containing private configuration. The provided backend source and manifest contain no credentials.
2. Settings → Pages → Build and deployment → Source: Deploy from a branch.
3. Select main and `/ (root)`, then Save. Keep index.html at that root. No build command is required.
4. Wait for deployment, then open the HTTPS Pages URL shown in Settings. A project site normally has a repository path. ALLOWED_ORIGINS still uses only `https://YOURNAME.github.io`.
5. Confirm both configuration URLs are correct and commit frontend changes. Hard refresh after script changes.
6. Open the site on your phone and complete the acceptance checklist in TESTS.md.

Other static hosts work the same way: upload the three frontend files, use HTTPS, add the site's origin to ALLOWED_ORIGINS. Do not open index.html using file://: it has an opaque/null origin and will be rejected. For local testing run `python -m http.server 8000` inside this folder and visit `http://localhost:8000`; add that exact origin in Script Properties first.

## 6. Using the application

- Add item: name required; optional SKU and notes; reorder defaults to zero; nonnegative integer starting counts.
- Move: pick Home → Truck or Truck → Home; enter a positive integer no larger than available stock.
- Adjust: set the NEW ACTUAL count, not the delta. Example: current 8, actual 6 → enter 6; the history quantity is -2.
- Edit: change product details without changing quantities.
- Archive: Edit → Archive item → confirm. Stock is retained in Sheets but excluded from active views, totals and search. Historical records remain. There is deliberately no permanent delete or restore UI; adding a restore feature should create an audited backend action.
- Search matches name, SKU and notes instantly. Home/Truck filters show products with positive stock at that location. Low and out-of-stock statuses use the COMBINED quantity, not each location separately.
- Low Stock dashboard includes every active product whose total <= reorder level, including zero-stock items. Status badges prioritize “Out of stock” when total is zero, then “Low stock”, otherwise “In stock”. Summary cards always summarize the full active inventory, not the filtered subset.
- History search queries the server by product name or ID, with a short debounce; results are newest first, 100 per page, with Load older activity. Search is not limited to the first page. Product names in old transactions are the names recorded at that time. Search by ID to include all names after renaming.

### History conventions

Every accepted write creates one transaction. TransactionID is the client-generated UUID requestId, making repeat delivery of the SAME request idempotent. Add quantity is the sum of starting units; transfer quantity is positive; adjustment quantity is the signed change; edit and archive quantities are 0. Adjustment endpoints use FromLocation for reductions and ToLocation for increases. PreviousQty and NewQty are JSON snapshots of both locations for stock operations, product details for edits, and counts plus Active for archive. Timestamps are server ISO UTC; the UI displays local time. Initial sample imports and direct spreadsheet edits are NOT audited.

## 7. API contract and reliability

GET actions: `getInventory`, `getTransactions`. Transactions supports `offset` (default 0), `limit` (default 100, max 200), optional `search` (name/ID substring), and optional `productId` (exact match).

POST actions and fields (all also require UUID `requestId`):

| action | Fields |
|---|---|
| addItem | Name, SKU, Notes, ReorderLevel, HomeQty, TruckQty |
| editItem | id, expectedUpdatedAt, Name, SKU, Notes, ReorderLevel |
| transfer | id, expectedUpdatedAt, from, to, quantity, note |
| adjust | id, expectedUpdatedAt, location, quantity, note |
| archiveItem | id, expectedUpdatedAt |

Locations are exactly `Home` and `Truck`. Pass the UpdatedAt from the current getInventory response as expectedUpdatedAt. The API returns `{ok:true,data:...}` or `{ok:false,error:"..."}`. Because Apps Script does not provide normal control of HTTP status codes for ContentService, inspect ok instead of assuming HTTP 200 means success. No spreadsheet identifier or secret is returned in normal responses.

The backend acquires ScriptLock, checks the product and revision, verifies stock/SKU rules, then submits ONE Advanced Sheets `spreadsheets.batchUpdate` containing the inventory row update and transaction append. Sheets applies all requests together atomically: if a request is invalid, none are applied. Transfers never write source and destination in separate API calls. Request IDs are checked in durable transaction history under the same lock. All text is written using explicit string values to prevent formula execution.

Locking and atomicity apply only to writes through this project; collaborators can still edit Sheet cells outside the lock. Protect the tabs and limit edit access. This spreadsheet implementation scans product rows for mutations and scans transaction IDs for duplicate detection; filtered history searches scan history. It is intended for modest inventories, not high-volume warehouse traffic. Pagination does not provide a frozen snapshot if new history arrives between pages; duplicate records are suppressed, and refresh restarts the listing. Back up your spreadsheet and monitor Apps Script quotas/executions. At larger scale use a transactional database and an authenticated API.

## 8. Troubleshooting

- Wrong CSV headers: publish Inventory only, with the exact header row.
- CSV HTTP error: check that it is the PUBLISHED CSV URL, not a normal edit link, and that publishing is enabled by your organization.
- Live connection fails: check `/exec`, anonymous access, setup authorization, deployment version, and Apps Script execution logs.
- Sheets is not defined: add Google Sheets API v4 as an advanced service named Sheets; run setup, authorize and redeploy.
- Writing disabled: ENABLE_PUBLIC_WRITES must be `true`. Review public access risks first.
- Frame timeout with no execution: check blockers, network, /exec access and deploy-as settings.
- Frame timeout with successful execution: verify ALLOWED_ORIGINS includes the page origin exactly; inspect iframe/browser console restrictions. Refresh before reattempting a potentially committed change.
- “Item changed”: another operation updated it. Close the dialog, refresh and re-enter the intended operation using fresh quantities.
- SKU rejected although absent from list: archived products reserve their SKU too; use another SKU or implement an audited restore flow.
- Stale published CSV: expected publication delay; the app uses live reads after initial preview.
- Setup refuses headers: restore the documented schemas. Never run destructive repair blindly.

## 9. Add a feature later

Example: add an audited “restore item” action without changing the schema:

1. Add an archived-items read view and a Restore button in the UI.
2. Add restoreItem to the server's action allowlist; locate the archived ID, validate its revision and intended active state.
3. Set Active true, update UpdatedAt, and append a restoration transaction in the same atomic batch.
4. Call the existing writeAPI with a fresh requestId and refresh live inventory after confirmation.
5. Add tests for repeated requests, stale revisions and archived SKU handling, then redeploy a new Apps Script version.

For a new field such as Category, update Inventory headers, migrate existing data safely, update server validation/serialization and the CSV header/parser, then add the UI field/search. Keep server-side rules authoritative and preserve history semantics.

## Official documentation used

- Google Sheets publishing and update delay: https://support.google.com/docs/answer/183965
- Sheets atomic batch updates: https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/batchUpdate
- Apps Script HTML sandbox restrictions: https://developers.google.com/apps-script/guides/html/restrictions
- GitHub Pages publishing source: https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site

## Verification scope

Local syntax and mocked logic tests are included; see TESTS.md. This package has not been deployed to your Google account, authorized, or exercised against your live Google Sheets/browser environment. Complete the deployment checklist before relying on it for real stock.
