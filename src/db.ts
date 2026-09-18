import "dotenv/config";
import pg from "pg";
import {
  Connector,
  IpAddressTypes
} from "@google-cloud/cloud-sql-connector";

const { Pool } = pg;

let pool: pg.Pool | null = null;
const connector = new Connector();

export async function getDb() {
  if (pool) return pool;

  // DESARROLLO LOCAL
  if (process.env.NODE_ENV !== "production") {
    console.log("DB MODE: LOCAL");

    pool = new Pool({
      host: process.env.DB_HOST ?? "127.0.0.1",
      port: Number(process.env.DB_PORT ?? 5432),
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
    });

    return pool;
  }

  // PRODUCCIÓN - CLOUD RUN
  console.log("DB MODE: CLOUD SQL");

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