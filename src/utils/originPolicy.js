'use strict';

const CLOUDFLARE_PAGES_HOST = 'kdo-command-center.pages.dev';

function isLocalDevelopmentOrigin(url) {
  return url.protocol === 'http:' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) &&
    !url.username && !url.password;
}

// Cloudflare Pages preview deployments use a project-scoped hostname:
// <deployment-or-branch>.<project>.pages.dev. Only this project is trusted.
function isCloudflarePagesOrigin(url) {
  if (url.protocol !== 'https:' || url.port || url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  return host === CLOUDFLARE_PAGES_HOST ||
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.kdo-command-center\.pages\.dev$/.test(host);
}

function isAllowedOrigin(origin, configuredOrigins = []) {
  if (!origin) return true;

  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }

  // An Origin header is an origin, not an arbitrary URL with a path/query.
  if (parsed.origin !== origin || parsed.username || parsed.password) return false;

  const explicitlyAllowed = configuredOrigins.some((configured) => {
    if (!configured || configured === '*') return false;
    try {
      const candidate = new URL(configured);
      return candidate.origin === origin && candidate.username === '' && candidate.password === '' &&
        (candidate.protocol === 'https:' || isLocalDevelopmentOrigin(candidate));
    } catch {
      return false;
    }
  });

  return explicitlyAllowed || isCloudflarePagesOrigin(parsed);
}

module.exports = { isAllowedOrigin };
