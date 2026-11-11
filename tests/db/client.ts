import { Client } from 'pg';

export async function connect(): Promise<Client> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set. Run the database tests with `npm run test:db`.');
  const client = new Client({ connectionString: url });
  await client.connect();
  return client;
}
