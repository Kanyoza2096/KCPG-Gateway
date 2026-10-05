import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const gatewayRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const commandCenterRoot = path.resolve(gatewayRoot, '../command-center');
const registry=JSON.parse(fs.readFileSync(path.join(gatewayRoot,'contracts/control-plane-command-registry.v1.json'),'utf8'));
const riskMap={low:'safe',medium:'caution',high:'dangerous'};
const label=id=>id.split('.').map(x=>x.split('_').map(y=>y.charAt(0).toUpperCase()+y.slice(1)).join(' ')).join(' ');
const commands=registry.commands.map(c=>({id:c.id,label:label(c.id),description:c.description,risk:riskMap[c.risk]||c.risk,requiredRole:c.minRole,scopes:c.scopes,workspaceRequired:c.workspaceRequired,expectedEvent:'command.result'}));
const out=`// GENERATED FROM gateway/contracts/control-plane-command-registry.v1.json — do not edit by hand.\nimport type { ControlCommandDefinition } from '../lib/controlPlaneCommands';\n\nexport const CANONICAL_CONTROL_COMMANDS: ControlCommandDefinition[] = ${JSON.stringify(commands)};\n`;
const dest=path.join(commandCenterRoot,'src/lib/generatedControlCommands.ts');
fs.writeFileSync(dest,out);
console.log(`wrote ${dest} commands=${commands.length}`);
