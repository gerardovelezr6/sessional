import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect } from './client';

let db: Client;
beforeAll(async () => { db = await connect(); });
afterAll(async () => { await db.end(); });

describe('public-assets bucket', () => {
  it('exists, is public, and only takes small images', async () => {
    const { rows } = await db.query(`select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'public-assets'`);
    expect(rows).toEqual([{ public: true, file_size_limit: '2097152', allowed_mime_types: ['image/png', 'image/jpeg', 'image/webp'] }]);
  });
});
