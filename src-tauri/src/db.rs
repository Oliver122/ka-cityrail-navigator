use diesel::prelude::*;
use diesel::sqlite::SqliteConnection;
use diesel_migrations::{embed_migrations, EmbeddedMigrations, MigrationHarness};
use serde::Serialize;

use crate::schema::{networks, stops};

pub const MIGRATIONS: EmbeddedMigrations = embed_migrations!("migrations");

/// Runs pending migrations and returns an open connection to the app SQLite DB.
/// Foreign-key enforcement is enabled on the connection before migrations run.
pub fn establish_connection(db_path: &str) -> SqliteConnection {
    let mut conn = SqliteConnection::establish(db_path)
        .unwrap_or_else(|e| panic!("Error connecting to {db_path}: {e}"));
    diesel::sql_query("PRAGMA foreign_keys = ON")
        .execute(&mut conn)
        .expect("Failed to enable foreign keys");
    conn.run_pending_migrations(MIGRATIONS)
        .expect("Failed to run migrations");
    conn
}

// ── Models ───────────────────────────────────────────────────────────────────

#[derive(Queryable, Selectable, Serialize, Debug)]
#[diesel(table_name = stops)]
pub struct Stop {
    pub id: String,
    pub name: String,
    pub longitude: f64,
    pub latitude: f64,
}

#[derive(Insertable)]
#[diesel(table_name = stops)]
pub struct NewStop<'a> {
    pub id: &'a str,
    pub name: &'a str,
    pub longitude: f64,
    pub latitude: f64,
}

// ── Repository helpers ────────────────────────────────────────────────────────

/// Upsert a stop (insert or replace).
pub fn upsert_stop(conn: &mut SqliteConnection, stop: NewStop) -> QueryResult<usize> {
    diesel::insert_into(stops::table)
        .values(&stop)
        .on_conflict(stops::id)
        .do_update()
        .set((
            stops::name.eq(stop.name),
            stops::longitude.eq(stop.longitude),
            stops::latitude.eq(stop.latitude),
        ))
        .execute(conn)
}

/// Upsert multiple stops in a single transaction.
pub fn upsert_stops(conn: &mut SqliteConnection, stops: Vec<NewStop<'_>>) -> QueryResult<usize> {
    use diesel::connection::Connection;
    conn.transaction(|conn| {
        let mut total = 0;
        for stop in stops {
            total += upsert_stop(conn, stop)?;
        }
        Ok(total)
    })
}

/// Return all persisted stops.
pub fn list_stops(conn: &mut SqliteConnection) -> QueryResult<Vec<Stop>> {
    stops::table.load::<Stop>(conn)
}

// ── Network models ────────────────────────────────────────────────────────────

#[derive(Queryable, Selectable, Serialize, Debug, Clone)]
#[diesel(table_name = networks)]
pub struct Network {
    pub ssid: String,
    pub label: String,
}

#[derive(Insertable)]
#[diesel(table_name = networks)]
pub struct NewNetwork<'a> {
    pub ssid: &'a str,
    pub label: &'a str,
}

pub fn list_networks(conn: &mut SqliteConnection) -> QueryResult<Vec<Network>> {
    networks::table.load::<Network>(conn)
}

pub fn upsert_network(conn: &mut SqliteConnection, net: NewNetwork) -> QueryResult<usize> {
    diesel::insert_into(networks::table)
        .values(&net)
        .on_conflict(networks::ssid)
        .do_update()
        .set(networks::label.eq(net.label))
        .execute(conn)
}

pub fn delete_network(conn: &mut SqliteConnection, ssid_val: &str) -> QueryResult<usize> {
    diesel::delete(networks::table.filter(networks::ssid.eq(ssid_val))).execute(conn)
}
