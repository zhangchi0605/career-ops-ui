// @ts-check
/** Swiss Confederation jobs source (jobs.admin.ch public Prospective API). */
import { fetchJson } from '../http-json.mjs';
import { decodeEntities } from '../html-entities.mjs';

const API_ORIGIN = 'https://ohws.prospective.ch';
const API_PATH = '/public/v1/medium/1000624/jobs';
const BOARD_HOST = 'jobs.admin.ch';
const DEFAULT_QUERIES = ['Procurement', 'Einkauf', 'Achats'];

export const meta = { value: 'jobs-admin', label: 'Swiss Confederation', region: 'en' };

function text(value) {
  return typeof value === 'string'
    ? decodeEntities(value.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
    : '';
}

function toIsoDate(value) {
  if (!value) return '';
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? '' : new Date(parsed).toISOString().slice(0, 10);
}

function cleanPostingUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === 'https:' && parsed.hostname.toLowerCase() === BOARD_HOST ? parsed.href : '';
  } catch {
    return '';
  }
}

function normalizeJob(row, fallbackCompany = 'Swiss Confederation') {
  if (!row || typeof row !== 'object') return null;
  const title = text(row.title || row.szas?.['sza_title']);
  const url = cleanPostingUrl(row.links?.directlink);
  if (!title || !url) return null;
  const attributes = row.attributes && typeof row.attributes === 'object' ? row.attributes : {};
  const szas = row.szas && typeof row.szas === 'object' ? row.szas : {};
  const company = text(attributes.verwaltungseinheit?.[0]) || fallbackCompany;
  const location = text(szas['sza_location.city']) || text(attributes.arbeitsort?.[0]) || text(szas['sza_location.country']);
  const description = [szas.sza_tasks, szas.sza_requirements, szas.sza_field_of_activity, szas.sza_company_profil]
    .map(text).filter(Boolean).join(' ');
  const haystack = `${title} ${location} ${description}`;
  const isRemote = /\b(remote|homeoffice|home office|anywhere)\b/i.test(haystack);
  return {
    id: `jobs-admin-${url}`,
    title,
    company,
    url,
    salary: '',
    location,
    isRemote,
    workplaceType: isRemote ? 'Remote' : (/\bhybrid\b/i.test(haystack) ? 'Hybrid' : 'Onsite'),
    relocates: /\b(visa|relocation|sponsorship)\b/i.test(haystack),
    date: toIsoDate(row.last_modification_timestamp || row.start_date),
    snippet: description.slice(0, 500),
    description,
    source: 'jobs-admin',
  };
}

/** Normalize one official API response. Exported for unit tests. */
export function parseJobsAdminResponse(payload, fallbackCompany) {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.jobs)) {
    throw new Error('jobs-admin: unexpected response shape; expected { jobs: [...] }');
  }
  return payload.jobs.map((row) => normalizeJob(row, fallbackCompany)).filter(Boolean);
}

function queriesFor(company) {
  const configured = company?.jobs_admin?.queries ?? company?.keywords;
  const values = Array.isArray(configured) ? configured : DEFAULT_QUERIES;
  return values.map(text).filter(Boolean).slice(0, 12);
}

function apiUrl(query, lang = 'en') {
  const url = new URL(`${API_ORIGIN}${API_PATH}`);
  url.searchParams.set('lang', typeof lang === 'string' && /^(de|en|fr|it)$/i.test(lang) ? lang : 'en');
  url.searchParams.set('q', query);
  url.searchParams.set('offset', '0');
  url.searchParams.set('limit', '96');
  return url.href;
}

/** Fetch and normalize the official Swiss Confederation vacancy index. */
export async function fetchJobsAdmin(_endpoint, opts = {}) {
  const { fetchImpl = fetch, signal, company = {} } = opts;
  const jobs = new Map();
  for (const query of queriesFor(company)) {
    const payload = await fetchJson(fetchImpl, apiUrl(query, company.jobs_admin?.lang), {
      signal,
      redirect: 'error',
      headers: { Accept: 'application/json' },
    });
    for (const job of parseJobsAdminResponse(payload, company.name || 'Swiss Confederation')) jobs.set(job.url, job);
  }
  return [...jobs.values()];
}
