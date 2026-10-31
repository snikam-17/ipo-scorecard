import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const sql = readFileSync(join(process.cwd(), 'db', 'schema.sql'), 'utf8');
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(sql);
    console.log('Schema applied.');
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
