/** JobCloud-family Swiss job-board adapter. */
import { fetchJobCloud, meta } from '../../sources/jobcloud.mjs';

const HOST_RE = /^(www\.)?(jobs|jobup|jobwinner|topjobs|alpha)\.ch$/i;

export const jobcloudAdapter = {
  id: meta.value,
  label: meta.label,
  matches(company) {
    if (!company || typeof company !== 'object') return false;
    if (company.provider === 'jobcloud') return true;
    const raw = typeof company.careers_url === 'string' ? company.careers_url : '';
    try {
      const url = new URL(raw);
      return url.protocol === 'https:' && HOST_RE.test(url.hostname);
    } catch {
      return false;
    }
  },
  buildEndpoint(company) {
    const raw = typeof company?.careers_url === 'string' ? company.careers_url : '';
    try {
      const url = new URL(raw);
      if (url.protocol === 'https:' && HOST_RE.test(url.hostname)) return url.href;
    } catch { /* provider-selected entries use the canonical jobs.ch board */ }
    return company?.provider === 'jobcloud' ? 'https://www.jobs.ch/en/vacancies/' : null;
  },
  fetch: fetchJobCloud,
};
