import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { expect, it } from 'vitest';
import { database, getRun } from '@/lib/server/store';

it('migrates a cached legacy connection without treating active runs as interrupted', async () => {
  const db = await PGlite.create();
  const cache = globalThis as typeof globalThis & { revDb?: Promise<PGlite>; revDbSchema?: unknown };
  try {
    await db.exec('CREATE TABLE runs (id UUID PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL, payload JSONB NOT NULL)');
    const id = randomUUID();
    const event = { id: randomUUID(), type: 'edge_proposed' };
    await db.query('INSERT INTO runs VALUES ($1, now(), $2::jsonb)', [
      id, JSON.stringify({ id, state: 'reconstructing', graphEvents: [event] }),
    ]);
    cache.revDb = Promise.resolve(db);

    expect(await database()).toBe(db);
    expect(await getRun(id)).toMatchObject({ state: 'reconstructing', graphEvents: [event], sourceEvents: [] });
  } finally {
    delete cache.revDb;
    delete cache.revDbSchema;
    await db.close();
  }
});
