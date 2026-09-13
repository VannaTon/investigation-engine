import type { Pool, PoolClient } from "pg";
import { postgres } from "../config/postgres.js";

export type LifecycleClient = Pick<PoolClient, "query">;
export type LifecycleTransaction = <T>(work: (client: LifecycleClient) => Promise<T>) => Promise<T>;

export function createAlertLifecycleTransaction(pool: Pick<Pool, "connect">): LifecycleTransaction {
  return async (work) => {
    const client = await pool.connect();
    let discarded = false;
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        client.release(rollbackError instanceof Error ? rollbackError : new Error("Rollback failed"));
        discarded = true;
        throw error;
      }
      throw error;
    } finally {
      // A failed rollback already discarded the connection.
      if (!discarded) client.release();
    }
  };
}

export const withAlertLifecycleTransaction = createAlertLifecycleTransaction(postgres);
