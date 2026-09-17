import { RowDataPacket } from "mysql2";
import { madhavi_pool } from "../../db";

// Looks up the internal auto-increment `id` for a row identified by its public UUID column.
// Table/column names here are always internal constants, never user input, so string
// interpolation is safe from injection.
async function resolveInternalId(
  table: string,
  uuidColumn: string,
  uuidValue: string,
): Promise<number | null> {
  const [rows] = await madhavi_pool.query<RowDataPacket[]>(
    `SELECT id FROM ${table} WHERE ${uuidColumn} = ? LIMIT 1`,
    [uuidValue],
  );

  return rows[0]?.id ?? null;
}

export { resolveInternalId };
