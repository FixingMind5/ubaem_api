import "dotenv/config";
import pg from "pg";
import {
  Connector,
  IpAddressTypes
} from "@google-cloud/cloud-sql-connector";

const { Pool } = pg;

let pool: pg.Pool | null = null;

export async function getDb() {
  if (pool) return pool;

  const connector = new Connector();

  const clientOpts = await connector.getOptions({
    instanceConnectionName:
      process.env.INSTANCE_CONNECTION_NAME!,
    ipType: IpAddressTypes.PRIVATE,
  });

  pool = new Pool({
    ...clientOpts,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    max: 5,
  });

  return pool;
}