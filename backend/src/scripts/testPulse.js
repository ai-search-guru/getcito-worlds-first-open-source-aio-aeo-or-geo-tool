/**
 * One-off manual test for the Daily Pulse engine (#540).
 * Run: node src/scripts/testPulse.js <brandId>
 */
import 'dotenv/config';
import { generatePulseForBrand } from '../lib/pulse/engine.js';

const brandId = process.argv[2];
if (!brandId) {
  console.error('Usage: node src/scripts/testPulse.js <brandId>');
  process.exit(1);
}

const result = await generatePulseForBrand(brandId);
console.log(JSON.stringify(result, null, 2));
process.exit(0);
