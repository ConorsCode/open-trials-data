# data/

This directory holds the current snapshot of the dataset, regenerated daily by
`.github/workflows/update.yml` running `scripts/fetch.mjs`.

## What "recruiting" means here

Every row is a study whose `overallStatus` was `RECRUITING` on
ClinicalTrials.gov **at the moment this snapshot was fetched**
(`data/summary.json.generatedAt`). This is not a historical or point-in-time
registry snapshot in the traditional sense — it's "what's open for
enrollment right now," recomputed fresh every day. A trial that was
recruiting yesterday and filled up today drops out of tomorrow's file with
no trace in this dataset (ClinicalTrials.gov itself retains the full
history; this repo doesn't).

## Files

- `trials.json` — every currently-recruiting interventional trial, as a JSON array.
- `trials.csv` — the same data as CSV (array fields like `conditions` are joined with `; `).
- `by-condition.json` — top 200 conditions by number of matching trials.
- `by-sponsor.json` — top 200 lead sponsors by number of matching trials.
- `by-phase.json` — every distinct phase value present, complete (not truncated).
- `summary.json` — total count, scope filters used, run duration, and notes on what's included/excluded.

## Schema (`trials.json` / `trials.csv`)

| Field | Type | Notes |
|---|---|---|
| `nctId` | string | ClinicalTrials.gov registry ID, e.g. `NCT04249830` |
| `briefTitle` | string | Short study title, as registered |
| `overallStatus` | string | Always `RECRUITING` in this dataset |
| `phase` | string \| null | e.g. `PHASE2`, combined phases like `PHASE1; PHASE2`, or `NA` |
| `studyType` | string | Always `INTERVENTIONAL` in this dataset |
| `conditions` | array of strings | Condition(s) under study |
| `interventions` | array of strings | Intervention/treatment name(s), as registered (includes drug, device, behavioral, etc.) |
| `leadSponsorName` | string \| null | Lead sponsor's registered name — can be an institution or, for investigator-initiated trials, a person's name |
| `leadSponsorClass` | string \| null | `INDUSTRY`, `NIH`, `FED`, `OTHER`, `OTHER_GOV`, `NETWORK`, `UNKNOWN` |
| `enrollmentCount` | number \| null | Target enrollment, sponsor-reported |
| `enrollmentType` | string \| null | `ESTIMATED` (still recruiting toward this number) or `ACTUAL` |
| `startDate` | string \| null | Study start, year-month or full date depending on what the sponsor registered |
| `completionDate` | string \| null | Expected or actual overall study completion date |
| `locationCountries` | array of strings | Deduplicated list of countries with at least one study site |
| `url` | string | `https://clinicaltrials.gov/study/{nctId}` |
| `scrapedAt` | string | ISO timestamp of this fetch |

Every field is `null` (not `0`/`false`/empty string) when ClinicalTrials.gov
doesn't report a value for that study.

## No personal data — by design

The fetcher requests only these API fields: NCTId, BriefTitle,
OverallStatus, Phase, StudyType, Condition, InterventionName,
LeadSponsorName, LeadSponsorClass, EnrollmentCount, EnrollmentType,
StartDate, CompletionDate, LocationCountry. ClinicalTrials.gov's API also
publishes per-site contact names, emails, and phone numbers on
`contactsLocationsModule.locations[].contacts` — none of that is requested
or stored anywhere in this repo.

## Phase distribution (why so many rows show `phase: "NA"`)

As of the run that shipped this repo, `by-phase.json` breaks down like this:

| Phase | Trial count |
|---|---|
| NA | 26,583 |
| PHASE2 | 6,985 |
| PHASE1 | 3,859 |
| PHASE3 | 3,405 |
| PHASE1; PHASE2 | 2,519 |
| PHASE4 | 2,236 |
| EARLY_PHASE1 | 1,001 |
| PHASE2; PHASE3 | 681 |
| NOT_APPLICABLE | 1 |

`NA` is ClinicalTrials.gov's own value for interventional studies that
don't use the drug-development phase system — device trials, behavioral
and procedural interventions, and similar. It is the single largest bucket
(~56% of this snapshot) and is expected, not a data quality issue.

## Aggregate files: what "top 200" means

`by-condition.json` and `by-sponsor.json` are ranked by trial count and
truncated to the top 200 entries — the tail of thousands of conditions or
sponsors with 1-2 trials each isn't included to keep those files a
reasonable size. `by-phase.json` has only 9 distinct values total, so it's
never truncated.

## Source and pagination

Source: `https://clinicaltrials.gov/api/v2/studies`, filtered with
`filter.overallStatus=RECRUITING` and `query.term=AREA[StudyType]INTERVENTIONAL`,
paginated via the API's `nextPageToken` cursor at the documented max page
size of 1,000. The fetcher follows `nextPageToken` until the API stops
returning one, up to a 200-page (200,000-study) safety cap — far above the
current ~47,000-study scope. `data/summary.json.hitPageSafetyCap` records
whether a given run hit that cap; if `true`, treat the dataset as
incomplete for that run.

See the top-level README for full scope, known limitations, and sample
output.
