# Christmas Day 2026 dining planner

A static, mobile-friendly planning dashboard for Christmas Day lunch or dinner on **Friday 25 December 2026** near **Windsor & Eton**, **Maidenhead, Bray & Taplow**, and **Paddington (London)**.

It is a **researched snapshot**, not a booking service. Venue facts were read from official venue pages and dated 2026 menus on **17 November 2026**. Prices, menus, sittings and availability can change, so reconfirm everything with the venue before you book. **No table availability has been checked for any venue.**

- Plain HTML, CSS and JavaScript. There's no build step, framework, backend, API key, external font, map SDK, analytics or tracking.
- Venue data lives in one editable file: [`data/venues.json`](data/venues.json).
- Favourites, notes, comparison picks and party size are saved only in your browser (`localStorage`).

```
index.html          page structure
styles.css          styles (light/dark, mobile, print)
app.js              search, filters, cards, compare, budget, enquiry, shortlist
data/venues.json    researched venue + travel data (edit this to update)
.nojekyll           tells GitHub Pages to serve files as-is
tests/              optional checks (not needed to host the site)
```

---

## 1. Create a GitHub repository and upload the files

1. Sign in at <https://github.com> and click **New** (or the **+** menu → **New repository**).
2. Give it a name, for example `christmas-dinner-2026`. Choose **Public**, which free GitHub Pages requires (see section 8), then click **Create repository**.
3. On the new repository page, click **uploading an existing file**.
4. Drag in **all** the project files and folders: `index.html`, `styles.css`, `app.js`, `README.md`, `.nojekyll`, and the `data` folder with `venues.json` inside. The `tests` folder is optional.
   - Tip: `.nojekyll` is a hidden file on some computers. If you can't see it, create it on GitHub with **Add file → Create new file**, name it `.nojekyll`, and leave it empty.
   - Keep `venues.json` inside a folder named `data`. If drag-and-drop flattens folders, use **Add file → Create new file** and type `data/venues.json` as the name, then paste the contents in.
5. Click **Commit changes**.

## 2. Turn on GitHub Pages ("Deploy from a branch")

1. In the repository, open **Settings → Pages** (left sidebar, under "Code and automation").
2. Under **Build and deployment → Source**, choose **Deploy from a branch**.

## 3. Pick the branch and the root folder

1. Under **Branch**, choose **`main`** (or whichever branch holds `index.html`).
2. In the folder dropdown next to it, choose **`/ (root)`**.
3. Click **Save**.

## 4. Find the published site

After a minute or two, refresh **Settings → Pages**. A box will say *"Your site is live at …"*. The address looks like:

```
https://<your-username>.github.io/<repository-name>/
```

The site uses only relative paths (`styles.css`, `app.js`, `data/venues.json`), so it works under that `/<repository-name>/` subdirectory without changes. If the page says the venue data couldn't load, check that `data/venues.json` exists in the repository and that the deploy has finished (**Actions** tab).

## 5. Update venue data and "last checked" dates

Edit `data/venues.json` on GitHub: open the file, click the pencil icon, make your change, then **Commit changes**. The site redeploys automatically.

Rules that keep the dashboard honest:

| Field | Meaning |
|---|---|
| `meta.researchedAt` | When the whole snapshot was taken (ISO date-time). Update it when you re-check things. |
| `lastChecked` (per venue) and `sources[].checked` | Date you last read that venue's official page (`YYYY-MM-DD`). |
| `christmasDay.status` | `"confirmed"` only when an official page or dated 2026 menu says food is served on 25 Dec 2026. Otherwise `"unconfirmed"`, which puts the venue in the "Worth contacting" section. |
| `availability.status` | `"verified"` **only** with `partySize`, `sitting` and `checkedAt` filled in. Use `"booking-route-open"` when there's just a booking page or phone number, plus `"sold-out"` or `"unknown"`. |
| `pricing.adult`, `pricing.child` | Numbers in pounds (e.g. `94` or `77.5`), or `null` if not published. **Never use `0` for unknown.** |
| `pricing.serviceCharge.status` | `"included"`, `"extra"` (with `rate`, e.g. `12.5`) or `"unknown"`. |
| `meals.lunch` / `meals.dinner` | `true`, `false`, or `null` (unknown). The "evening service" count uses `dinner: true`. |
| `nonresident.status` | `"welcome"`, `"restricted"` or `"unknown"`. |
| `category` | `"pub"`, `"hotel-restaurant"` or `"restaurant"`. |
| `area` | `"windsor-eton"`, `"maidenhead-bray-taplow"` or `"paddington"`. |
| `recommendation.pick` / `score` | Editorial only. The three highest-scored confirmed venues with `pick: true` appear as "Best fit for us". |

**Refresh analysis button:** after committing a data change, wait for GitHub Pages to redeploy (usually 1–2 minutes), then click **↻ Refresh analysis** at the top of the page. It downloads the latest `data/venues.json` and recalculates everything: counts, picks, filters, comparison, budget and enquiry list. Your filters, favourites, notes and party size are kept. A status line says whether anything changed and shows any new research snapshot date. If the download fails, the data already on screen is kept. The button does **not** search the web or check table availability, because the site is static. New research only appears when someone updates `data/venues.json`.

Each venue needs a unique lowercase `id` (letters, numbers, hyphens). Don't change an `id` once you have notes saved against it. If a record is missing required fields, the page skips it and shows a warning, so the rest of the page still works.

Optional check (needs [Node.js](https://nodejs.org)): `node tests/validate-data.js`

## 6. Preview locally

Opening `index.html` by double-clicking it (a `file://` address) usually **won't load the venue data**: browsers block pages opened from disk from fetching other files, such as `data/venues.json`. Run a tiny local web server instead:

```bash
# from inside the project folder (Python 3 is preinstalled on macOS/Linux)
python3 -m http.server 8000
# then open http://localhost:8000/
```

On Windows, use `py -m http.server 8000`. Press `Ctrl+C` to stop the server.

To mimic GitHub Pages' subdirectory, run the server from the folder **above** the project and open `http://localhost:8000/<project-folder-name>/`.

Optional browser tests (need Node.js and Playwright): start the server one level above the project on port 8765, then run
`BASE=http://localhost:8765/<project-folder-name>/ node tests/ui-test.js`.

## 7. Export and import your shortlist

- **Save** (☆) on a card adds it to favourites. **My notes** on each card holds a private note.
- In **My shortlist & notes**:
  - **Export shortlist & notes (JSON)** downloads `christmas-2026-shortlist.json` with your favourites, notes, comparison picks and party size.
  - **Import from JSON…** loads a previously exported file. It **replaces** what is stored in this browser. Files are checked first: invalid JSON, files from elsewhere, oversized files and malformed entries are rejected with a message. Notes for venues no longer in the data are kept and flagged.
  - **Print shortlist** prints your favourites and noted venues, with source and booking URLs written out in full.
- Use export/import to move your shortlist to another device or browser, or to share it with the rest of your party.

## 8. What is public and what is private

- **GitHub Pages publishes the site publicly.** Anyone with the link can see `index.html` and `data/venues.json`. Don't put personal information, such as names, phone numbers, addresses, booking references or dietary or medical details, in the repository. The search-engine "noindex" tag is a request, not protection.
- **Your favourites, notes and party size stay in your browser.** They are stored in `localStorage` on that device only. They are **not** uploaded to GitHub, not shared with other visitors, and don't sync between devices. Clearing your browser's site data deletes them, so export a copy if they matter.
- The enquiry helper only **copies** text to your clipboard. Nothing is ever sent from this page.

---

## Research summary (snapshot 17 Nov 2026)

**Confirmed for Christmas Day 2026 (official sources):**

| Venue | Area | Adult | Child | Meal |
|---|---|---|---|---|
| Sir Christopher Wren Hotel | Windsor | £159 | £77.50 (under 12) | Lunch |
| The Carpenter's Arms | Windsor | £94 | unknown | Times unknown |
| The Windsor Lad (Harvester) | Windsor | unknown | unknown | Times unknown |
| The Greene Oak | Oakley Green, Windsor | £110 | £55 (under 12) | Lunch 12–3pm (pre-order deadline 2 Nov has passed) |
| Fairmont Windsor Park | Englefield Green (Windsor Great Park edge) | unknown | unknown | Lunch |
| The Braywood | Paley Street, Maidenhead | £180 (veg £160) | unknown | Lunch only |
| The Thatched Cottage | Maidenhead | £62.95 | unknown | Times unknown |
| Coppa Club Maidenhead | Maidenhead | £100 | unknown | Lunch |
| Smith's Bar & Grill | Paddington | £99 | £30 | 12pm–9.30pm (lunch **and** dinner) |
| Royal Lancaster — Christmas brunch | Lancaster Gate (near Paddington) | £325 | £125 (under 12) | 1.00pm / 2.30pm |
| Royal Lancaster — festive afternoon tea | Lancaster Gate | £95 | unknown for 25 Dec | Afternoon |

**Travel:** National Rail's official notice says no trains run on Christmas Day or Boxing Day 2026, Elizabeth line and GWR included. TfL's 2026 Christmas Day arrangements couldn't be read from an official source and are shown as awaiting confirmation.

**Gaps:** no Eton venue was confirmed. Macdonald Windsor's official page couldn't be read (bot protection), so it is listed as a lead only. See the "Worth contacting" section in the dashboard for all leads.
