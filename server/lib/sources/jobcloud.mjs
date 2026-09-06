// @ts-check
/**
 * JobCloud-family source for the Swiss boards jobs.ch, jobup.ch,
 * jobwinner.ch, topjobs.ch and alpha.ch.
 *
 * These public search pages expose either JSON-LD JobPosting records or a
 * Next.js payload. The source keeps the fetches host-pinned and returns the
 * rich job shape used by the web UI; title/location/content filtering remains
 * the scanner's responsibility.
 */
import { fetchText, BROWSER_LIKE_USER_AGENT } from '../http-json.mjs';
import { decodeEntities } from '../html-entities.mjs';

export const SOURCES = [
  { host: 'www.jobs.ch', hosts: /^(www\.)?jobs\.ch$/i, path: '/en/vacancies/', queryParam: 'term', format: 'jsonld' },
  { host: 'www.jobup.ch', hosts: /^(www\.)?jobup\.ch$/i, path: '/en/jobs/', queryParam: 'term', format: 'jsonld' },
  { host: 'www.jobwinner.ch', hosts: /^(www\.)?jobwinner\.ch$/i, path: '/en/jobs', queryParam: 'q', format: 'next' },
  { host: 'www.topjobs.ch', hosts: /^(www\.)?topjobs\.ch$/i, path: '/en/jobs', queryParam: 'q', format: 'next' },
  { host: 'www.alpha.ch', hosts: /^(www\.)?alpha\.ch$/i, path: '/en/jobs', queryParam: 'q', format: 'next' },
];

const DEFAULT_QUERIES = ['Procurement', 'Einkauf', 'Achats'];
const DEFAULT_MAX_PAGES = 2;
const MAX_PAGES_CAP = 20;
const SNIPPET_MAX = 500;

export const meta = {
  value: 'jobcloud',
  label: 'JobCloud (jobs.ch / jobup.ch / jobwinner.ch / topjobs.ch / alpha.ch)',
  region: 'en',
};

function text(value) {
  return typeof value === 'string'
    ? decodeEntities(value.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
    : '';
}

function sourceForHost(host) {
  return SOURCES.find((source) => source.hosts.test(host)) || null;
}

function sourceForEndpoint(endpoint) {
  let parsed;
  try { parsed = new URL(endpoint); } catch { return null; }
  if (parsed.protocol !== 'https:') return null;
  const source = sourceForHost(parsed.hostname.toLowerCase());
  return source ? { source, parsed } : null;
}

function toIsoDate(value) {
  if (!value) return '';
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? '' : new Date(parsed).toISOString().slice(0, 10);
}

function safeId(value) {
  const candidate = String(value ?? '').trim();
  return candidate && /^[A-Za-z0-9._~-]+$/.test(candidate) ? candidate : '';
}

function cleanUrl(value, source) {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === 'https:' && source.hosts.test(parsed.hostname)
      ? parsed.href
      : '';
  } catch {
    return '';
  }
}

function normalizeLocation(jobLocation) {
  const locations = Array.isArray(jobLocation) ? jobLocation : [jobLocation];
  const values = [];
  for (const place of locations) {
    const address = place?.address || {};
    const value = [address.addressLocality, address.addressRegion, address.addressCountry]
      .map(text).filter(Boolean).join(', ');
    if (value && !values.includes(value)) values.push(value);
  }
  return values.join('; ');
}

function normalizePosting(posting, source) {
  if (!posting || typeof posting !== 'object') return null;
  const title = text(posting.title);
  const url = cleanUrl(posting.url, source);
  if (!title || !url) return null;
  const description = text(posting.description);
  const location = normalizeLocation(posting.jobLocation);
  const haystack = `${title} ${location} ${description}`;
  const isRemote = /\b(remote|anywhere|fully distributed)\b/i.test(haystack);
  const workplaceType = isRemote ? 'Remote' : (/\bhybrid\b/i.test(haystack) ? 'Hybrid' : 'Onsite');
  return {
    id: `jobcloud-${url}`,
    title,
    company: text(posting.hiringOrganization?.name),
    url,
    salary: '',
    location,
    isRemote,
    workplaceType,
    relocates: /\b(visa|relocation|sponsorship)\b/i.test(haystack),
    date: toIsoDate(posting.datePosted),
    snippet: description.slice(0, SNIPPET_MAX),
    description,
    source: 'jobcloud',
  };
}

function parseJsonLd(html, source) {
  const jobs = [];
  let structured = false;
  const scripts = html.match(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) || [];
  for (const script of scripts) {
    const body = script.replace(/^<[\s\S]*?>/, '').replace(/<\/script>\s*$/i, '');
    let value;
    try { value = JSON.parse(body); } catch { continue; }
    for (const item of (Array.isArray(value) ? value : [value])) {
      if (item?.['@type'] !== 'ItemList' || !Array.isArray(item.itemListElement)) continue;
      structured = true;
      for (const element of item.itemListElement) {
        if (element?.item?.['@type'] === 'JobPosting') {
          const job = normalizePosting(element.item, source);
          if (job) jobs.push(job);
        }
      }
    }
  }
  return { jobs, structured };
}

function normalizeNextJob(job, source) {
  if (!job || typeof job !== 'object') return null;
  const title = text(job.title);
  const id = safeId(job.jobId);
  if (!title || !id) return null;
  const location = text(job.location);
  const description = text(job.description || job.summary);
  const haystack = `${title} ${location} ${description}`;
  const isRemote = /\b(remote|anywhere|fully distributed)\b/i.test(haystack);
  return {
    id: `jobcloud-${source.host}-${id}`,
    title,
    company: text(job.companyName),
    url: `https://${source.host}/en/job/${id}`,
    salary: '',
    location,
    isRemote,
    workplaceType: isRemote ? 'Remote' : (/\bhybrid\b/i.test(haystack) ? 'Hybrid' : 'Onsite'),
    relocates: /\b(visa|relocation|sponsorship)\b/i.test(haystack),
    date: toIsoDate(job.datePosted),
    snippet: description.slice(0, SNIPPET_MAX),
    description,
    source: 'jobcloud',
  };
}

function parseNextData(html, source) {
  const match = html.match(/<script\s+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match) return { jobs: [], structured: false };
  let data;
  try { data = JSON.parse(match[1]); } catch { return { jobs: [], structured: false }; }
  const rows = data?.props?.pageProps?.jobsSSR?.jobs;
  if (!Array.isArray(rows)) return { jobs: [], structured: false };
  return { jobs: rows.map((job) => normalizeNextJob(job, source)).filter(Boolean), structured: true };
}

/** Parse one JobCloud result page. Exported for unit tests. */
export function parseJobCloudPage(html, source) {
  if (typeof html !== 'string' || !html.trim()) return [];
  const parsed = source.format === 'next' ? parseNextData(html, source) : parseJsonLd(html, source);
  if (!parsed.structured) throw new Error(`jobcloud: ${source.host} result page has no expected structured job data`);
  return parsed.jobs;
}

function queriesFor(company) {
  const configured = company?.jobcloud?.queries ?? company?.keywords;
  const values = Array.isArray(configured) ? configured : DEFAULT_QUERIES;
  return values.map(text).filter(Boolean).slice(0, 12);
}

function maxPagesFor(company) {
  const value = company?.max_pages;
  return Number.isInteger(value) && value > 0 ? Math.min(value, MAX_PAGES_CAP) : DEFAULT_MAX_PAGES;
}

function pageUrl(source, query, page) {
  const url = new URL(`https://${source.host}${source.path}`);
  url.searchParams.set(source.queryParam, query);
  url.searchParams.set('page', String(page));
  return url.href;
}

/** Fetch and normalize one of the five JobCloud-family boards. */
export async function fetchJobCloud(endpoint, opts = {}) {
  const { fetchImpl = fetch, signal, company = {} } = opts;
  const resolved = sourceForEndpoint(endpoint);
  if (!resolved) throw new Error('jobcloud: endpoint must be a supported HTTPS JobCloud host');
  const { source } = resolved;
  const queries = queriesFor(company);
  const jobs = new Map();
  const maxPages = maxPagesFor(company);

  for (const query of queries) {
    for (let page = 1; page <= maxPages; page += 1) {
      let html;
      try {
        html = await fetchText(fetchImpl, pageUrl(source, query, page), {
          signal,
          redirect: 'error',
          headers: { 'User-Agent': BROWSER_LIKE_USER_AGENT, Accept: 'text/html,application/xhtml+xml' },
        });
      } catch (err) {
        if (page === 1 && jobs.size === 0) throw err;
        break;
      }
      const pageJobs = parseJobCloudPage(html, source);
      for (const job of pageJobs) jobs.set(job.url, job);
      if (pageJobs.length === 0) break;
    }
  }
  return [...jobs.values()];
}
