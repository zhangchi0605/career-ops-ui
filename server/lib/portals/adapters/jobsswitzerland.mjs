/** jobsswitzerland.ch RSS adapter. */
import { fetchJobsSwitzerland, FEED_URL, meta } from '../../sources/jobsswitzerland.mjs';

function matchesCompany(company) {
  if (company?.provider === 'jobsswitzerland') return true;
  const raw = typeof company?.careers_url === 'string' ? company.careers_url : '';
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && /^(www\.)?jobsswitzerland\.ch$/i.test(url.hostname);
  } catch {
    return false;
  }
}

export const jobsswitzerlandAdapter = {
  id: meta.value,
  label: meta.label,
  matches: matchesCompany,
  buildEndpoint(company) {
    return matchesCompany(company) ? FEED_URL : null;
  },
  fetch: fetchJobsSwitzerland,
};
