import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const core = JSON.parse(fs.readFileSync(path.join(root, 'contracts/kanyoza-route-manifest.v1.json'), 'utf8')).routes;
const supplemental = JSON.parse(fs.readFileSync(path.join(root, 'contracts/kanyoza-mounted-route-supplement.v1.json'), 'utf8')).routes;
const frontendManifest = JSON.parse(fs.readFileSync(path.resolve(root, 'contracts/kdo-route-manifest.v1.json'), 'utf8'));
const frontend = frontendManifest.routes;
const bff = fs.readFileSync(path.join(root, 'src/routes/bff.js'), 'utf8');

function extract(name) {
  const match = bff.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`));
  return match ? [...match[1].matchAll(/['"]([^'"]+)['"]/g)].map(item => item[1]) : [];
}
const readPrefixes = extract('READ_PREFIXES');
const mutationPrefixes = extract('MUTATION_PREFIXES');
const sensitivePrefixes = extract('SENSITIVE_READ_PREFIXES');
const safePosts = [
  ...[...bff.matchAll(/const SAFE_ONBOARDING_POSTS = \\[([\\s\\S]*?)\\];/g)].flatMap(m => [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map(x => x[1])),
  ...[...bff.matchAll(/const SAFE_SENSITIVE_READ_POSTS = \\[([\\s\\S]*?)\\];/g)].flatMap(m => [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map(x => x[1])),
];
const gatewayNative = frontendManifest.gatewayNativePrefixes || [];
const dedicatedGateway = frontendManifest.dedicatedGatewayPrefixes || [];
const strip = value => (value.replace(/^\\/api\\/v1/, '') || '/').replace(/\\/+$/, '') || '/';
const shape = value => value.replace(/\\{[^}]+\\}/g, '{}');
const matches = (pathname, prefixes) => prefixes.some(prefix => pathname === prefix || pathname.startsWith(prefix + '/'));
const backend = [...core, ...supplemental];
const exact = new Set(backend.map(route => `${route.method} ${strip(route.path)}`));
const byShape = new Set(backend.map(route => `${route.method} ${shape(strip(route.path))}`));
const failures = [];
let matchedBackend = 0, gatewayNativeCount = 0, dedicatedGatewayCount = 0, bffReadCount = 0, bffMutationCount = 0;
for (const route of frontend) {
  const pathname = route.path;
  if (matches(pathname, gatewayNative)) { gatewayNativeCount += 1; continue; }
  const key = `${route.method} ${pathname}`;
  if (!exact.has(key) && !byShape.has(`${route.method} ${shape(pathname)}`)) {
    failures.push({ type: 'frontend-route-with-no-mounted-backend', method: route.method, path: pathname });
    continue;
  }
  matchedBackend += 1;
  if (matches(pathname, dedicatedGateway)) { dedicatedGatewayCount += 1; continue; }
  if (!matches(pathname, readPrefixes)) {
    failures.push({ type: 'gateway-read-not-allowlisted', method: route.method, path: pathname });
    continue;
  }
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(route.method)) {
    if (!safePosts.includes(pathname) && !matches(pathname, mutationPrefixes)) {
      failures.push({ type: 'gateway-mutation-not-allowlisted', method: route.method, path: pathname });
      continue;
    }
    bffMutationCount += 1;
  } else {
    bffReadCount += 1;
  }
  if (matches(pathname, sensitivePrefixes)) {
    // The BFF's middleware enforces control.read for these prefixes.
  }
}
const report = {
  schema: 'KDORouteDriftReport/v2',
  coreBackendCount: core.length,
  supplementalBackendCount: supplemental.length,
  frontendCount: frontend.length,
  matchedBackendRoutes: matchedBackend,
  gatewayNativeRoutes: gatewayNativeCount,
  dedicatedGatewayRoutes: dedicatedGatewayCount,
  bffReadRoutes: bffReadCount,
  bffMutationRoutes: bffMutationCount,
  failures,
  warnings: [{
    type: 'static-source-audit',
    message: 'This certifies source declarations and gateway allowlists, not runtime reachability, provider credentials, external API quotas, or principal-specific authorization success.'
  }],
  sources: {
    coreBackend: 'contracts/kanyoza-route-manifest.v1.json',
    supplementalBackend: 'contracts/kanyoza-mounted-route-supplement.v1.json',
    frontend: 'contracts/kdo-route-manifest.v1.json',
    gateway: 'src/routes/bff.js and dedicated KCPG route mounts'
  },
  policy: { gatewayNativePrefixes: gatewayNative, dedicatedGatewayPrefixes: dedicatedGateway }
};
fs.writeFileSync(path.join(root, 'PHASE67_ROUTE_DRIFT_REPORT.json'), JSON.stringify(report, null, 2) + '\\n');
console.log(`core=${core.length} supplemental=${supplemental.length} frontend=${frontend.length} backendMatched=${matchedBackend} native=${gatewayNativeCount} dedicated=${dedicatedGatewayCount} failures=${failures.length}`);
if (failures.length) process.exit(2);
