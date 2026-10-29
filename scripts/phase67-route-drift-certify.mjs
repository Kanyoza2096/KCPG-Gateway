import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const backend = JSON.parse(fs.readFileSync(path.join(root, 'contracts/kanyoza-route-manifest.v1.json'), 'utf8')).routes;
const frontend = JSON.parse(fs.readFileSync(path.resolve(root, 'contracts/kdo-route-manifest.v1.json'), 'utf8')).routes;
const bff = fs.readFileSync(path.join(root, 'src/routes/bff.js'), 'utf8');
const prefixes = [...bff.matchAll(/const (?:READ_PREFIXES|MUTATION_PREFIXES) = \[([\s\S]*?)\];/g)]
  .flatMap(m => [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map(x => x[1]));
const gatewayNative = new Set(['/auth/control-login','/auth/session','/commands','/control-plane/gateway/observability','/control-plane/gateway/slo','/command-center','/director','/proxy']);
const strip = p => p.replace(/^\/api\/v1/, '') || '/';
const bset = new Set(backend.map(r => `${r.method} ${strip(r.path)}`));
const shape = p => p.replace(/\{[^}]+\}/g, '{}');
const backendByShape = new Map();
for (const r of backend) backendByShape.set(`${r.method} ${shape(strip(r.path))}`, r.path);
const failures = [];
const warnings = [];
for (const r of frontend) {
  const p = r.path;
  if ([...gatewayNative].some(x => p === x || p.startsWith(`${x}/`))) continue;
  const exact = `${r.method} ${p}`;
  if (bset.has(`GET ${p}`) || bset.has(`${r.method} ${p}`)) continue;
  const shapeKey = `${r.method} ${shape(p)}`;
  if (backendByShape.has(shapeKey)) {
    warnings.push({type:'parameter-name-difference',method:r.method,path:p,backendPath:backendByShape.get(shapeKey)}); continue;
  }
  if (!prefixes.some(x => p === x || p.startsWith(`${x}/`))) {
    failures.push({type:'gateway-not-allowlisted',method:r.method,path:p}); continue;
  }
  failures.push({type:'frontend-route-with-no-backend',method:r.method,path:p});
}

// Detect duplicate semantic backend routes (same method + normalized shape) across modules.
const sem = new Map();
for (const r of backend) {
  const k = `${r.method} ${shape(strip(r.path))}`;
  const prev = sem.get(k); if (prev && prev !== r.path) warnings.push({type:'duplicate-semantic-backend-route',method:r.method,shape:k,paths:[prev,r.path]});
  else sem.set(k,r.path);
}
const report = {schema:'RouteDriftReport/v1', backendCount:backend.length, frontendCount:frontend.length, failures, warnings, policy:{gatewayNative:[...gatewayNative]}};
fs.writeFileSync(path.join(root,'PHASE67_ROUTE_DRIFT_REPORT.json'), JSON.stringify(report,null,2)+'\n');
console.log(`backend=${backend.length} frontend=${frontend.length} failures=${failures.length} warnings=${warnings.length}`);
for (const x of failures.slice(0,80)) console.log(`FAIL ${x.type}: ${x.method} ${x.path}${x.backendPath?` -> ${x.backendPath}`:''}`);
if (failures.length) process.exit(2);
