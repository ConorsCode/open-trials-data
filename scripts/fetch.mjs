#!/usr/bin/env node
// Standalone, zero-dependency fetcher for the open-trials-data dataset.
//
// Pulls all currently-recruiting interventional clinical trials from
// ClinicalTrials.gov API v2 (no API key, no auth), a public paginated JSON
// endpoint (`pageToken`-based cursor pagination). Writes data/trials.json,
// data/trials.csv, three aggregate files, and data/summary.json.
//
// This is intentionally narrow: recruiting + interventional only (no
// observational studies, no completed/terminated/withdrawn history), one
// fixed scope, no arbitrary condition/sponsor query at request time.
//
// No personal data: only institutional fields are requested (see the
// `FIELDS` list below) — no investigator names, emails, or phone numbers,
// even though ClinicalTrials.gov publishes some of those for contacts.

import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const BASE_URL = 'https://clinicaltrials.gov/api/v2/studies';

// Scope: overallStatus = RECRUITING, studyType = INTERVENTIONAL. Chosen
// because it's the single largest genuinely-useful "what can I enroll in
// right now" cut the API supports directly via filter params, and it's
// bounded (~47k studies as of the run that shipped this repo — see
// data/summary.json for the live count). Observational studies and any
// other status (completed, terminated, not-yet-recruiting, etc.) are
// excluded — see README "Limitations".
const FILTER_STATUS = 'RECRUITING';
const QUERY_TERM = 'AREA[StudyType]INTERVENTIONAL';

// Field list kept deliberately institutional-only: no contact names,
// emails, or phone numbers even though the API exposes them on
// contactsLocationsModule.locations[].contacts.
const FIELDS = [
  'NCTId',
  'BriefTitle',
  'OverallStatus',
  'Phase',
  'StudyType',
  'Condition',
  'InterventionName',
  'LeadSponsorName',
  'LeadSponsorClass',
  'EnrollmentCount',
  'EnrollmentType',
  'StartDate',
  'CompletionDate',
  'LocationCountry',
].join(',');

const PAGE_SIZE = 1000; // API's documented max page size.
const REQUEST_DELAY_MS = 200;
const MAX_RETRIES = 4;
const RETRY_BASE_MS = 750;
const FETCH_TIMEOUT_MS = 30000;
const USER_AGENT = 'open-trials-data/1.0 (+https://github.com/) polite-bot';
const MAX_PAGES = 200; // safety cap: 200 * 1000 = 200,000 studies, far above the current ~47k scope.
const TOP_N = 200;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nowIso() {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// HTTP helper — the one and only place a network call is made.
//
// IMPORTANT: the abort timeout must stay armed until the response BODY is
// fully read, not just until headers arrive. Clearing it early and reading
// the body afterwards leaves a stalled-mid-body response with no timeout
// and no way to retry — it just hangs forever.
// ---------------------------------------------------------------------------

async function getJsonWithRetry(url) {
  let lastErr;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        signal: controller.signal,
      });
      const text = await res.text();
      clearTimeout(timeout);
      if (res.status === 429 || res.status >= 500) {
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
      }
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} (non-retryable): ${text.slice(0, 300)}`);
      }
      try {
        return JSON.parse(text);
      } catch {
        throw new Error(`Bad JSON response: ${text.slice(0, 300)}`);
      }
    } catch (err) {
      clearTimeout(timeout);
      lastErr = err;
      const nonRetryable = err instanceof Error && err.message.includes('non-retryable');
      if (nonRetryable) throw err;
      if (attempt < MAX_RETRIES) {
        const backoff = RETRY_BASE_MS * 2 ** attempt + Math.random() * 300;
        console.log(`  retry ${attempt + 1}/${MAX_RETRIES} after error: ${err.message} (waiting ${Math.round(backoff)}ms)`);
        await sleep(backoff);
        continue;
      }
    }
  }
  throw lastErr ?? new Error('fetch failed');
}

// ---------------------------------------------------------------------------
// Fetch: paginate via pageToken until the API stops returning one
// ---------------------------------------------------------------------------

async function fetchAllStudies() {
  const studies = [];
  let pageToken = null;
  let page = 0;

  while (page < MAX_PAGES) {
    const params = new URLSearchParams({
      format: 'json',
      pageSize: String(PAGE_SIZE),
      'filter.overallStatus': FILTER_STATUS,
      'query.term': QUERY_TERM,
      fields: FIELDS,
    });
    if (pageToken) params.set('pageToken', pageToken);

    let response;
    try {
      response = await getJsonWithRetry(`${BASE_URL}?${params.toString()}`);
    } catch (err) {
      console.error(`  page ${page} failed after retries: ${err.message}. Stopping pagination, keeping ${studies.length} collected so far.`);
      break;
    }

    const pageStudies = response.studies ?? [];
    studies.push(...pageStudies);
    page += 1;
    console.log(`  page ${page}: +${pageStudies.length} (total ${studies.length})`);

    pageToken = response.nextPageToken ?? null;
    if (!pageToken || pageStudies.length === 0) break;
    await sleep(REQUEST_DELAY_MS);
  }
  return studies;
}

// ---------------------------------------------------------------------------
// Normalize
// ---------------------------------------------------------------------------

function normalize(study, scrapedAt) {
  const ps = study.protocolSection ?? {};
  const id = ps.identificationModule ?? {};
  const status = ps.statusModule ?? {};
  const sponsor = ps.sponsorCollaboratorsModule?.leadSponsor ?? {};
  const conditions = ps.conditionsModule?.conditions ?? [];
  const design = ps.designModule ?? {};
  const interventions = (ps.armsInterventionsModule?.interventions ?? []).map((i) => i.name).filter(Boolean);
  const locations = ps.contactsLocationsModule?.locations ?? [];
  const countries = [...new Set(locations.map((l) => l.country).filter(Boolean))];

  return {
    nctId: id.nctId ?? null,
    briefTitle: id.briefTitle ?? null,
    overallStatus: status.overallStatus ?? null,
    phase: (design.phases ?? []).join('; ') || null,
    studyType: design.studyType ?? null,
    conditions,
    interventions,
    leadSponsorName: sponsor.name ?? null,
    leadSponsorClass: sponsor.class ?? null,
    enrollmentCount: design.enrollmentInfo?.count ?? null,
    enrollmentType: design.enrollmentInfo?.type ?? null,
    startDate: status.startDateStruct?.date ?? null,
    completionDate: status.completionDateStruct?.date ?? null,
    locationCountries: countries,
    url: id.nctId ? `https://clinicaltrials.gov/study/${id.nctId}` : null,
    scrapedAt,
  };
}

// ---------------------------------------------------------------------------
// Aggregates
// ---------------------------------------------------------------------------

function buildByCondition(trials) {
  const byCondition = new Map();
  for (const t of trials) {
    for (const c of t.conditions) {
      const entry = byCondition.get(c) ?? { condition: c, trialCount: 0 };
      entry.trialCount += 1;
      byCondition.set(c, entry);
    }
  }
  return [...byCondition.values()].sort((a, b) => b.trialCount - a.trialCount).slice(0, TOP_N);
}

function buildBySponsor(trials) {
  const bySponsor = new Map();
  for (const t of trials) {
    if (!t.leadSponsorName) continue;
    const key = t.leadSponsorName;
    const entry = bySponsor.get(key) ?? { leadSponsorName: key, leadSponsorClass: t.leadSponsorClass ?? null, trialCount: 0 };
    entry.trialCount += 1;
    bySponsor.set(key, entry);
  }
  return [...bySponsor.values()].sort((a, b) => b.trialCount - a.trialCount).slice(0, TOP_N);
}

function buildByPhase(trials) {
  const byPhase = new Map();
  for (const t of trials) {
    const key = t.phase ?? 'NOT_APPLICABLE';
    byPhase.set(key, (byPhase.get(key) ?? 0) + 1);
  }
  return [...byPhase.entries()]
    .map(([phase, trialCount]) => ({ phase, trialCount }))
    .sort((a, b) => b.trialCount - a.trialCount);
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

const CSV_HEADERS = [
  'nctId', 'briefTitle', 'overallStatus', 'phase', 'studyType', 'conditions', 'interventions',
  'leadSponsorName', 'leadSponsorClass', 'enrollmentCount', 'enrollmentType', 'startDate',
  'completionDate', 'locationCountries', 'url', 'scrapedAt',
];

function toCsv(rows) {
  const escape = (v) => {
    if (v === null || v === undefined) return '';
    const s = Array.isArray(v) ? v.join('; ') : String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [CSV_HEADERS.join(',')];
  for (const row of rows) {
    lines.push(CSV_HEADERS.map((h) => escape(row[h])).join(','));
  }
  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const startedAt = Date.now();
  const scrapedAt = nowIso();

  console.log(`Fetching ClinicalTrials.gov studies (status=${FILTER_STATUS}, query=${QUERY_TERM})...`);
  const rawStudies = await fetchAllStudies();
  console.log(`Fetched ${rawStudies.length} raw studies.`);

  const trials = rawStudies.map((s) => normalize(s, scrapedAt)).filter((t) => t.nctId);
  const elapsedMs = Date.now() - startedAt;

  const byCondition = buildByCondition(trials);
  const bySponsor = buildBySponsor(trials);
  const byPhase = buildByPhase(trials);

  await mkdir(path.join(ROOT, 'data'), { recursive: true });

  await writeFile(path.join(ROOT, 'data', 'trials.json'), JSON.stringify(trials, null, 2) + '\n');
  await writeFile(path.join(ROOT, 'data', 'trials.csv'), toCsv(trials));
  await writeFile(path.join(ROOT, 'data', 'by-condition.json'), JSON.stringify(byCondition, null, 2) + '\n');
  await writeFile(path.join(ROOT, 'data', 'by-sponsor.json'), JSON.stringify(bySponsor, null, 2) + '\n');
  await writeFile(path.join(ROOT, 'data', 'by-phase.json'), JSON.stringify(byPhase, null, 2) + '\n');

  const summary = {
    generatedAt: scrapedAt,
    filterOverallStatus: FILTER_STATUS,
    queryTerm: QUERY_TERM,
    totalTrials: trials.length,
    uniqueConditions: byCondition.length >= TOP_N ? `${TOP_N}+ (truncated in by-condition.json)` : byCondition.length,
    uniqueSponsors: bySponsor.length >= TOP_N ? `${TOP_N}+ (truncated in by-sponsor.json)` : bySponsor.length,
    hitPageSafetyCap: rawStudies.length >= MAX_PAGES * PAGE_SIZE,
    source: 'https://clinicaltrials.gov/api/v2/studies',
    elapsedMs,
    notes: [
      'Scope is studies with overallStatus=RECRUITING and studyType=INTERVENTIONAL at fetch time — observational studies and any other status (completed, terminated, not-yet-recruiting, active-not-recruiting, etc.) are NOT included.',
      'locationCountries is country-level only, deduplicated — no facility names, addresses, or investigator/contact personal data are collected, even though ClinicalTrials.gov publishes some of those fields.',
      'enrollmentCount/enrollmentType reflect the sponsor\'s own target and its type (ESTIMATED vs ACTUAL) as published — not independently verified.',
      'by-condition.json and by-sponsor.json are each truncated to the top 200 by trial count; by-phase.json is complete.',
    ],
  };
  await writeFile(path.join(ROOT, 'data', 'summary.json'), JSON.stringify(summary, null, 2) + '\n');

  console.log(`Done in ${(elapsedMs / 1000).toFixed(1)}s.`);
  console.log(`Total trials: ${trials.length}`);
  console.log(`Top 3 conditions:`, byCondition.slice(0, 3).map((c) => `${c.condition} (${c.trialCount})`));
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
