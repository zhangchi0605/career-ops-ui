// @ts-check
/** jobsswitzerland.ch public RSS source. */
import { fetchText } from '../http-json.mjs';
import { decodeEntities } from '../html-entities.mjs';

export const FEED_URL = 'https://jobsswitzerland.ch/en/rss.xml';
const BOARD_HOST = 'jobsswitzerland.ch';

export const meta = { value: 'jobsswitzerland', label: 'Jobs Switzerland', region: 'en' };

function extractText(inner) {
  const cdata = inner.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  return decodeEntities((cdata ? cdata[1] : inner).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function tagText(block, tag) {
  const match = block.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return match ? extractText(match[1]) : '';
}

function cleanUrl(value) {
  if (!value) return '';
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === 'https:' && parsed.hostname.toLowerCase() === BOARD_HOST ? parsed.href : '';
  } catch {
    return '';
  }
}

function toIsoDate(value) {
  if (!value) return '';
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? '' : new Date(parsed).toISOString().slice(0, 10);
}

/** Parse the public RSS feed. Exported for unit tests. */
export function parseJobsSwitzerlandFeed(xml) {
  if (typeof xml !== 'string') return [];
  const jobs = [];
  const items = xml.match(/<item\b[^>]*>[\s\S]*?<\/item>/gi) || [];
  for (const item of items) {
    const url = cleanUrl(tagText(item, 'link') || tagText(item, 'guid'));
    const rawTitle = tagText(item, 'title');
    if (!url || !rawTitle) continue;
    const pieces = rawTitle.split(/\s+·\s+/);
    const title = pieces[0].trim();
    if (!title) continue;
    const description = tagText(item, 'description');
    const location = (tagText(item, 'category').match(/(?:Zurich|Zürich|Zug|Basel|Geneva|Genève|Lausanne|Bern|Switzerland|Schweiz)/i) || [])[0] || '';
    const haystack = `${title} ${location} ${description}`;
    const isRemote = /\b(remote|anywhere|homeoffice)\b/i.test(haystack);
    jobs.push({
      id: `jobsswitzerland-${url}`,
      title,
      company: pieces.length > 1 ? pieces[pieces.length - 1].trim() : 'Jobs Switzerland',
      url,
      salary: '',
      location,
      isRemote,
      workplaceType: isRemote ? 'Remote' : (/\bhybrid\b/i.test(haystack) ? 'Hybrid' : 'Onsite'),
      relocates: /\b(visa|relocation|sponsorship)\b/i.test(haystack),
      date: toIsoDate(tagText(item, 'pubDate')),
      snippet: description.slice(0, 500),
      description,
      source: 'jobsswitzerland',
    });
  }
  return jobs;
}

/** Fetch the newest public jobsswitzerland.ch postings. */
export async function fetchJobsSwitzerland(_endpoint, opts = {}) {
  const { fetchImpl = fetch, signal } = opts;
  const xml = await fetchText(fetchImpl, FEED_URL, {
    signal,
    redirect: 'error',
    headers: { Accept: 'application/rss+xml, application/xml, text/xml' },
  });
  return parseJobsSwitzerlandFeed(xml);
}
