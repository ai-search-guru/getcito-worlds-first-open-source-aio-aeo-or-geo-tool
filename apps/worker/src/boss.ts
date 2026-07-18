import { PgBoss } from "pg-boss";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
	throw new Error("DATABASE_URL is required for pg-boss");
}

const boss = new PgBoss({
	connectionString,
	// Use same DB as app, pg-boss creates its own schema
	schema: "pgboss",

	// How often pg-boss runs maintenance tasks
	maintenanceIntervalSeconds: 30,
});

export default boss;
