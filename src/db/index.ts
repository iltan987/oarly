import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { env } from '@/env';

import * as schema from './schema';

const pool = new Pool({ connectionString: env.DATABASE_URL });

export const db = drizzle(pool, { schema });
export type DB = typeof db;

/** The drizzle transaction handle — the first argument to `db.transaction(async (tx) => …)`. */
export type Tx = Parameters<Parameters<DB['transaction']>[0]>[0];

/**
 * Anything that can run a statement. Helpers that must be callable both standalone
 * and inside a caller's transaction take this, so no call site needs
 * `tx as unknown as DB` — a cast that silently defeats the type system's only
 * check that an audit row lands in the same transaction as its mutation.
 */
export type DbOrTx = DB | Tx;
