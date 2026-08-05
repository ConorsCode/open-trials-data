# open-trials-data

A free, daily-updated dataset of all currently-recruiting interventional
clinical trials worldwide, pulled directly from ClinicalTrials.gov's public
API v2 and normalized into one schema.

Current snapshot: **47,270 recruiting interventional trials** (last full
run: 2026-08-05, 43.8s). Numbers move daily as trials open, close, or change
status — see `data/summary.json` for the current count.

Data lives in [`data/`](data/):

- [`data/trials.json`](data/trials.json) — every trial, as JSON
- [`data/trials.csv`](data/trials.csv) — same data as CSV
- [`data/by-condition.json`](data/by-condition.json) — top 200 conditions by trial count
- [`data/by-sponsor.json`](data/by-sponsor.json) — top 200 lead sponsors by trial count
- [`data/by-phase.json`](data/by-phase.json) — every trial phase, complete
- [`data/summary.json`](data/summary.json) — totals, run stats, scope notes
- [`data/README.md`](data/README.md) — schema doc

A GitHub Actions workflow (`.github/workflows/update.yml`) re-runs the
fetcher every day and commits whatever changed. No manual updates.

## Why this exists

ClinicalTrials.gov publishes a public, unauthenticated, paginated JSON API
(v2) covering every registered trial. It's comprehensive but not
pre-filtered to "what can I actually enroll in right now" — that requires
querying by status and study type and paging through the result set
yourself. This repo does that once a day: recruiting, interventional trials
only, normalized into one flat schema, so you get a CSV instead of writing
a paginator.

## Scope (read this before relying on this for anything important)

This dataset is **not all of ClinicalTrials.gov**. It is scoped to:

- `overallStatus = RECRUITING` — actively enrolling participants at fetch time.
- `studyType = INTERVENTIONAL` — trials that assign participants to a
  treatment/intervention. Observational studies are excluded entirely.

That is roughly 47,000 of ClinicalTrials.gov's ~597,000 total registered
studies (per the registry's own `/api/v2/stats/size` endpoint). Excluded:
completed, terminated, withdrawn, suspended, not-yet-recruiting, and
active-not-recruiting trials, and all observational studies. If you need
those, query the API directly — see "Using the data" below for the
endpoint shape.

## Schema

| Field | Type | Notes |
|---|---|---|
| `nctId` | string | ClinicalTrials.gov registry ID |
| `briefTitle` | string | Short study title, as registered |
| `overallStatus` | string | Always `RECRUITING` in this dataset |
| `phase` | string \| null | e.g. `PHASE2`, `PHASE1; PHASE2`, or `NA` for non-drug/device studies |
| `studyType` | string | Always `INTERVENTIONAL` in this dataset |
| `conditions` | array of strings | Condition(s) under study, as registered |
| `interventions` | array of strings | Intervention/treatment name(s) |
| `leadSponsorName` | string \| null | Lead sponsor's registered name |
| `leadSponsorClass` | string \| null | e.g. `INDUSTRY`, `NIH`, `OTHER`, `FED`, `NETWORK` |
| `enrollmentCount` | number \| null | Sponsor's target enrollment |
| `enrollmentType` | string \| null | `ESTIMATED` or `ACTUAL` |
| `startDate` | string \| null | Study start date, as registered (year-month or full date) |
| `completionDate` | string \| null | Expected/actual overall completion date |
| `locationCountries` | array of strings | Countries with a study site, deduplicated (no facility names or addresses) |
| `url` | string | Direct link to the study's public ClinicalTrials.gov page |
| `scrapedAt` | string | ISO timestamp of the fetch that produced this row |

### Sample row (from the live run above)

```json
{
  "nctId": "NCT04249830",
  "briefTitle": "Stem Cell Transplant From Donors After Alpha Beta Cell Depletion in Children and Young Adults",
  "overallStatus": "RECRUITING",
  "phase": "NA",
  "studyType": "INTERVENTIONAL",
  "conditions": ["Hematologic Diseases"],
  "interventions": ["Allogeneic Stem Cell Transplant", "CliniMACS TCR α/β Reagent Kit and CliniMACS CD19"],
  "leadSponsorName": "Alice Bertaina",
  "leadSponsorClass": "OTHER",
  "enrollmentCount": 204,
  "enrollmentType": "ESTIMATED",
  "startDate": "2020-02-01",
  "completionDate": "2030-12",
  "locationCountries": ["United States"],
  "url": "https://clinicaltrials.gov/study/NCT04249830",
  "scrapedAt": "2026-08-05T03:31:37.976Z"
}
```

A second real row, showing a non-US, larger-enrollment trial:

```json
{
  "nctId": "NCT07143149",
  "briefTitle": "Effect of the Intelligent Lipid Management Decision-support System on 1-year LDL-C Target Achievement in Ischemic Stroke or TIA Patients Under Evolocumab Treatment in China",
  "overallStatus": "RECRUITING",
  "phase": "NA",
  "studyType": "INTERVENTIONAL",
  "conditions": ["Ischemic Stroke", "Transient Ischemic Attack (TIA)"],
  "interventions": ["the Intelligent Lipid Management Decision-support System"],
  "leadSponsorName": "Beijing Tiantan Hospital",
  "leadSponsorClass": "OTHER",
  "enrollmentCount": 4000,
  "enrollmentType": "ESTIMATED",
  "startDate": "2025-11-03",
  "completionDate": "2028-03-31",
  "locationCountries": ["China"],
  "url": "https://clinicaltrials.gov/study/NCT07143149",
  "scrapedAt": "2026-08-05T03:31:37.976Z"
}
```

## Using the data

### curl

```bash
curl -s https://raw.githubusercontent.com/ConorsCode/open-trials-data/main/data/trials.json | jq '.[0]'
```

### pandas

```python
import pandas as pd
df = pd.read_json("https://raw.githubusercontent.com/ConorsCode/open-trials-data/main/data/trials.json")
df.explode("conditions").groupby("conditions").size().sort_values(ascending=False).head(20)
```

### JavaScript

```js
const trials = await fetch(
  "https://raw.githubusercontent.com/ConorsCode/open-trials-data/main/data/trials.json"
).then((r) => r.json());

const phase3 = trials.filter((t) => t.phase?.includes("PHASE3"));
console.log(`${phase3.length} recruiting Phase 3 trials`);
```

## Limitations (read before relying on this for anything important)

- **Recruiting + interventional only.** See "Scope" above. This is a
  useful, bounded slice, not a complete registry mirror.
- **`phase` is `NA` for most rows.** Roughly 56% of trials in this dataset
  have phase `NA` — device trials, behavioral interventions, and other
  study types that don't use the drug-development phase system. This is
  expected, not missing data.
- **No personal data.** Only institutional fields are collected — sponsor
  organization name/class, country-level locations. This dataset does not
  include investigator names, emails, phone numbers, or facility addresses,
  even though ClinicalTrials.gov's API exposes some of those on individual
  study records.
- **`locationCountries` is country-level only**, deduplicated — no city,
  state, facility name, or recruitment status per site.
- **`enrollmentCount`/`enrollmentType` are sponsor-reported targets**, not
  independently verified, and `ESTIMATED` vs `ACTUAL` matters — a study
  that hasn't finished enrolling reports an estimate, not a final count.
- **Snapshot timing.** A trial can change status (fill up, pause, close)
  within minutes of `scrapedAt`. Don't treat a day-old row as still
  recruiting without checking `url`.
- **`by-condition.json` and `by-sponsor.json` are truncated to the top
  200** by trial count, to keep the aggregate files a reasonable size.
  `by-phase.json` is complete (there are only 9 distinct phase values).

## License

MIT — see [`LICENSE`](LICENSE). The code is MIT licensed; the trial data
itself is republished from ClinicalTrials.gov, a public registry maintained
by the US National Library of Medicine.

## Related open datasets

Part of a small set of free, daily-refreshed datasets built the same way:
zero-dependency Node fetcher, GitHub Actions refresh, public endpoints only.

- **[Open Jobs Data](https://github.com/ConorsCode/open-jobs-data)** — 15,919 open job postings from 90 companies across nine applicant tracking systems.
- **[Open FedSpend Data](https://github.com/ConorsCode/open-fedspend-data)** — 28,092 recent US federal contract awards from USAspending.gov, with recipient and agency aggregates.
- **[Open Dependency Risk](https://github.com/ConorsCode/open-dependency-risk)** — 1,500 widely-used npm and PyPI packages joined with known vulnerabilities from OSV.dev.
