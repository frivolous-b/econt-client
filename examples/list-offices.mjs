// No credentials needed — the nomenclature endpoints are open.
// Run: node examples/list-offices.mjs
import { fetchOffices } from '../dist/index.js';

const res = await fetchOffices();
if (!res.ok) {
  console.error(`Failed (${res.reason}): ${res.detail}`);
  process.exit(1);
}

console.log(`Offices: ${res.rows.length} (dropped: ${res.droppedRows})`);
for (const kind of ['office', 'aps', 'mps']) {
  console.log(`  ${kind}: ${res.rows.filter((o) => o.kind === kind).length}`);
}

const plovdiv = res.rows.filter((o) => o.addressText?.includes('Пловдив')).slice(0, 5);
console.log('\nSample (Пловдив):');
for (const o of plovdiv) {
  console.log(`  [${o.extCode}] ${o.name} — ${o.hoursFrom}–${o.hoursTo}`);
}
