/** Swiss-native source adapters — parser and host/redirect contract tests. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SOURCES as JOBCLOUD_SOURCES,
  parseJobCloudPage,
  fetchJobCloud,
  meta as jobcloudMeta,
} from '../server/lib/sources/jobcloud.mjs';
import { jobcloudAdapter } from '../server/lib/portals/adapters/jobcloud.mjs';
import {
  parseJobsAdminResponse,
  fetchJobsAdmin,
  meta as adminMeta,
} from '../server/lib/sources/jobs-admin.mjs';
import { jobsAdminAdapter } from '../server/lib/portals/adapters/jobs-admin.mjs';
import {
  parseJobsSwitzerlandFeed,
  fetchJobsSwitzerland,
  FEED_URL,
  meta as swissMeta,
} from '../server/lib/sources/jobsswitzerland.mjs';
import { jobsswitzerlandAdapter } from '../server/lib/portals/adapters/jobsswitzerland.mjs';

const jsonLd = `<!doctype html><script type="application/ld+json">${JSON.stringify({
  '@type': 'ItemList',
  itemListElement: [{ item: {
    '@type': 'JobPosting',
    title: 'Strategic Procurement Manager',
    url: 'https://www.jobs.ch/en/vacancies/detail/abc/',
    hiringOrganization: { name: 'Acme AG' },
    jobLocation: { address: { addressLocality: 'Zug', addressCountry: 'CH' } },
    datePosted: '2026-09-01',
    description: '<p>Own supplier strategy.</p>',
  } }],
})}</script>`;

const nextData = `<!doctype html><script id="__NEXT_DATA__">${JSON.stringify({
  props: { pageProps: { jobsSSR: { jobs: [{
    jobId: '42', title: 'Category Buyer', companyName: 'Beta SA', location: 'Geneva', datePosted: '2026-09-02',
  }] } } },
})}</script>`;

function textResponse(body) {
  return { ok: true, status: 200, text: async () => body };
}

test('Swiss source metadata and adapters are discoverable', () => {
  assert.deepEqual(jobcloudMeta, {
    value: 'jobcloud',
    label: 'JobCloud (jobs.ch / jobup.ch / jobwinner.ch / topjobs.ch / alpha.ch)',
    region: 'en',
  });
  assert.equal(adminMeta.value, 'jobs-admin');
  assert.equal(swissMeta.value, 'jobsswitzerland');
  assert.equal(JOBCLOUD_SOURCES.length, 5);
  assert.ok(jobcloudAdapter.matches({ careers_url: 'https://jobs.ch/en/vacancies/' }));
  assert.ok(jobcloudAdapter.matches({ provider: 'jobcloud' }));
  assert.equal(jobcloudAdapter.matches({ careers_url: 'https://evil.example/jobs.ch' }), false);
  assert.ok(jobsAdminAdapter.matches({ careers_url: 'https://jobs.admin.ch/' }));
  assert.ok(jobsAdminAdapter.matches({ provider: 'jobs-admin' }));
  assert.ok(jobsswitzerlandAdapter.matches({ careers_url: 'https://jobsswitzerland.ch/en/' }));
});

test('jobcloud parses JSON-LD jobs.ch results into the UI job shape', () => {
  const source = JOBCLOUD_SOURCES.find((item) => item.host === 'www.jobs.ch');
  const [job] = parseJobCloudPage(jsonLd, source);
  assert.equal(job.title, 'Strategic Procurement Manager');
  assert.equal(job.company, 'Acme AG');
  assert.equal(job.location, 'Zug, CH');
  assert.equal(job.date, '2026-09-01');
  assert.equal(job.source, 'jobcloud');
  assert.match(job.description, /supplier strategy/);
});

test('jobcloud parses Next.js jobwinner/topjobs-style results', () => {
  const source = JOBCLOUD_SOURCES.find((item) => item.host === 'www.topjobs.ch');
  const [job] = parseJobCloudPage(nextData, source);
  assert.equal(job.title, 'Category Buyer');
  assert.equal(job.company, 'Beta SA');
  assert.equal(job.url, 'https://www.topjobs.ch/en/job/42');
  assert.equal(job.location, 'Geneva');
});

test('jobcloud fetch pins the board host, query and redirect policy', async () => {
  const calls = [];
  const jobs = await fetchJobCloud('https://www.jobs.ch/en/vacancies/', {
    company: { jobcloud: { queries: ['Procurement'] }, max_pages: 1 },
    fetchImpl: async (url, opts) => {
      calls.push({ url, opts });
      return textResponse(jsonLd);
    },
  });
  assert.equal(jobs.length, 1);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /^https:\/\/www\.jobs\.ch\/en\/vacancies\/\?term=Procurement&page=1$/);
  assert.equal(calls[0].opts.redirect, 'error');
});

test('jobcloud fails closed when expected structured data disappears', () => {
  const source = JOBCLOUD_SOURCES.find((item) => item.host === 'www.jobs.ch');
  assert.throws(() => parseJobCloudPage('<html>blocked</html>', source), /expected structured job data/);
});

const adminPayload = {
  jobs: [{
    title: 'Procurement Specialist',
    links: { directlink: 'https://jobs.admin.ch/job/123' },
    attributes: { verwaltungseinheit: ['Federal Department'] },
    szas: {
      'sza_location.city': 'Bern',
      sza_tasks: '<p>Manage tenders.</p>',
      sza_requirements: 'Supplier management',
    },
    start_date: '2026-09-03',
  }],
};

test('Swiss Confederation normalizes official records and filters invalid URLs', () => {
  const [job] = parseJobsAdminResponse(adminPayload);
  assert.equal(job.title, 'Procurement Specialist');
  assert.equal(job.company, 'Federal Department');
  assert.equal(job.location, 'Bern');
  assert.equal(job.date, '2026-09-03');
  assert.equal(job.source, 'jobs-admin');
  assert.equal(parseJobsAdminResponse({ jobs: [{ title: 'bad', links: { directlink: 'https://evil.example/x' } }] }).length, 0);
});

test('Swiss Confederation fetch uses fixed public API and redirect:error', async () => {
  const calls = [];
  const jobs = await fetchJobsAdmin('ignored', {
    company: { name: 'Swiss Confederation', jobs_admin: { lang: 'de', queries: ['Einkauf'] } },
    fetchImpl: async (url, opts) => {
      calls.push({ url, opts });
      return { ok: true, status: 200, json: async () => adminPayload };
    },
  });
  assert.equal(jobs.length, 1);
  assert.match(calls[0].url, /^https:\/\/ohws\.prospective\.ch\/public\/v1\/medium\/1000624\/jobs\?/);
  assert.equal(new URL(calls[0].url).searchParams.get('lang'), 'de');
  assert.equal(new URL(calls[0].url).searchParams.get('q'), 'Einkauf');
  assert.equal(calls[0].opts.redirect, 'error');
});

const feed = `<?xml version="1.0"?><rss><channel><item>
  <title><![CDATA[Senior Buyer · Acme AG]]></title>
  <link>https://jobsswitzerland.ch/en/jobs/1</link>
  <description><![CDATA[Procurement role in Zürich]]></description>
  <pubDate>Tue, 02 Sep 2026 10:00:00 GMT</pubDate>
</item><item><title>Ignore</title><link>https://evil.example/x</link></item></channel></rss>`;

test('Jobs Switzerland parses its public RSS and keeps only board-host URLs', () => {
  const [job] = parseJobsSwitzerlandFeed(feed);
  assert.equal(job.title, 'Senior Buyer');
  assert.equal(job.company, 'Acme AG');
  assert.equal(job.date, '2026-09-02');
  assert.equal(job.source, 'jobsswitzerland');
  assert.equal(parseJobsSwitzerlandFeed(feed).length, 1);
});

test('Jobs Switzerland fetch is fixed to the public RSS feed', async () => {
  const calls = [];
  const jobs = await fetchJobsSwitzerland('https://evil.example/rss', {
    fetchImpl: async (url, opts) => {
      calls.push({ url, opts });
      return textResponse(feed);
    },
  });
  assert.equal(jobs.length, 1);
  assert.equal(calls[0].url, FEED_URL);
  assert.equal(calls[0].opts.redirect, 'error');
});
