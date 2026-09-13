import { clickhouse } from "../config/clickhouse.js";

export class StatsRepository {
  private async groupBy<T>(column: string): Promise<T[]> {
    const result = await clickhouse.query({
      query: `
            SELECT
                ${column},
                COUNT(*) AS total
            FROM logs
            GROUP BY ${column}
            ORDER BY total DESC
        `,
      format: "JSONEachRow",
    });

    return result.json<T>();
  }
  async countByLevel() {
    const rows = await this.groupBy<{
      level: string;
      total: string;
    }>("level");

    return rows.map((row) => ({
      level: row.level,
      total: Number(row.total),
    }));
  }

  async countByService() {
    const rows = await this.groupBy<{
      service: string;
      total: string;
    }>("service");

    return rows.map((row) => ({
      service: row.service,
      total: Number(row.total),
    }));
  }

  async errorsOverTime() {
    const result = await clickhouse.query({
      query: `
      SELECT
        toStartOfMinute(timestamp) AS time,
        COUNT(*) AS total
      FROM logs
      WHERE level = 'error'
      GROUP BY time
      ORDER BY time ASC
    `,
      format: "JSONEachRow",
    });

    const rows = await result.json<{
      time: string;
      total: string;
    }>();

    return rows.map((row) => ({
      time: row.time,
      total: Number(row.total),
    }));
  }

  async topErrors(limit = 10) {
    const result = await clickhouse.query({
      query: `
      SELECT
        message,
        COUNT(*) AS total
      FROM logs
      WHERE level = 'error'
      GROUP BY message
      ORDER BY total DESC
      LIMIT {limit:UInt32}
    `,
      query_params: {
        limit,
      },
      format: "JSONEachRow",
    });

    const rows = await result.json<{
      message: string;
      total: string;
    }>();

    return rows.map((row) => ({
      message: row.message,
      total: Number(row.total),
    }));
  }
}
