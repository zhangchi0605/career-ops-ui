/** Swiss Confederation official vacancy adapter. */
import { fetchJobsAdmin, meta } from '../../sources/jobs-admin.mjs';

function matchesCompany(company) {
  if (company?.provider === 'jobs-admin') return true;
  const raw = typeof company?.careers_url === 'string' ? company.careers_url : '';
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && /^(www\.)?jobs\.admin\.ch$/i.test(url.hostname);
  } catch {
    return false;
  }
}

export const jobsAdminAdapter = {
  id: meta.value,
  label: meta.label,
  matches: matchesCompany,
  buildEndpoint(company) {
    if (matchesCompany(company)) return 'https://ohws.prospective.ch/public/v1/medium/1000624/jobs';
    return null;
  },
  fetch: fetchJobsAdmin,
};
