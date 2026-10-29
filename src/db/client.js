/**
 * Thin helpers over @forge/sql so the rest of the code never builds SQL
 * strings by hand with user data in them. Always use `?` placeholders.
 */
import { sql } from '@forge/sql';
import { randomUUID } from 'node:crypto';

export const newId = () => randomUUID();

/** SELECT rows. */
export async function query(text, params = []) {
  const stmt = sql.prepare(text);
  const res = params.length ? await stmt.bindParams(...params).execute() : await stmt.execute();
  return res.rows ?? [];
}

/** SELECT one row or null. */
export async function queryOne(text, params = []) {
  const rows = await query(text, params);
  return rows[0] ?? null;
}

/** INSERT / UPDATE / DELETE. Returns affectedRows. */
export async function execute(text, params = []) {
  const stmt = sql.prepare(text);
  const res = params.length ? await stmt.bindParams(...params).execute() : await stmt.execute();
  return res.rows?.affectedRows ?? 0;
}

/**
 * Insert a row from a plain object. Columns are taken from the object keys,
 * which must be trusted identifiers (never user input). JSON values are
 * stringified; undefined keys are skipped.
 */
export async function insert(table, row) {
  const data = { id: row.id ?? newId(), ...row };
  const cols = Object.keys(data).filter((k) => data[k] !== undefined);
  const vals = cols.map((k) => encode(data[k]));
  const placeholders = cols.map(() => '?').join(', ');
  await execute(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`, vals);
  return data.id;
}

/** UPDATE by id from a plain object (same identifier rules as insert). */
export async function updateById(table, id, patch) {
  const cols = Object.keys(patch).filter((k) => patch[k] !== undefined);
  if (!cols.length) return 0;
  const sets = cols.map((k) => `${k} = ?`).join(', ');
  const vals = cols.map((k) => encode(patch[k]));
  return execute(`UPDATE ${table} SET ${sets} WHERE id = ?`, [...vals, id]);
}

function encode(v) {
  if (v === null) return null;
  if (v instanceof Date) return toSqlDateTime(v);
  if (typeof v === 'object') return JSON.stringify(v);
  if (typeof v === 'boolean') return v ? 1 : 0;
  return v;
}

/** JSON columns come back as strings or objects depending on the driver. */
export function parseJson(v, fallback = null) {
  if (v === null || v === undefined) return fallback;
  if (typeof v === 'object') return v;
  try {
    return JSON.parse(v);
  } catch {
    return fallback;
  }
}

/** 'YYYY-MM-DD HH:MM:SS' in UTC. */
export function toSqlDateTime(d = new Date()) {
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

/** 'YYYY-MM-DD' in UTC. */
export function toSqlDate(d = new Date()) {
  return d.toISOString().slice(0, 10);
}
