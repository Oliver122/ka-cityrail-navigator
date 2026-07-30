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

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_conn() -> (tempfile::TempDir, SqliteConnection) {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("test.db");
        let conn = establish_connection(path.to_str().expect("utf8 path"));
        (dir, conn)
    }

    #[test]
    fn upsert_stop_then_list() {
        let (_dir, mut conn) = temp_conn();
        upsert_stop(
            &mut conn,
            NewStop {
                id: "s1",
                name: "Marktplatz",
                longitude: 8.4,
                latitude: 49.0,
            },
        )
        .unwrap();
        let stops = list_stops(&mut conn).unwrap();
        assert_eq!(stops.len(), 1);
        assert_eq!(stops[0].id, "s1");
        assert_eq!(stops[0].name, "Marktplatz");
        assert_eq!(stops[0].longitude, 8.4);
        assert_eq!(stops[0].latitude, 49.0);
    }

    #[test]
    fn upsert_stop_same_id_updates_name() {
        let (_dir, mut conn) = temp_conn();
        upsert_stop(
            &mut conn,
            NewStop {
                id: "s1",
                name: "Old",
                longitude: 8.4,
                latitude: 49.0,
            },
        )
        .unwrap();
        upsert_stop(
            &mut conn,
            NewStop {
                id: "s1",
                name: "New",
                longitude: 8.5,
                latitude: 49.1,
            },
        )
        .unwrap();
        let stops = list_stops(&mut conn).unwrap();
        assert_eq!(stops.len(), 1);
        assert_eq!(stops[0].name, "New");
        assert_eq!(stops[0].longitude, 8.5);
        assert_eq!(stops[0].latitude, 49.1);
    }

    #[test]
    fn upsert_stops_two_ids() {
        let (_dir, mut conn) = temp_conn();
        upsert_stops(
            &mut conn,
            vec![
                NewStop {
                    id: "a",
                    name: "A",
                    longitude: 1.0,
                    latitude: 2.0,
                },
                NewStop {
                    id: "b",
                    name: "B",
                    longitude: 3.0,
                    latitude: 4.0,
                },
            ],
        )
        .unwrap();
        assert_eq!(list_stops(&mut conn).unwrap().len(), 2);
    }

    #[test]
    fn upsert_network_then_list() {
        let (_dir, mut conn) = temp_conn();
        upsert_network(
            &mut conn,
            NewNetwork {
                ssid: "HomeWiFi",
                label: "Home",
            },
        )
        .unwrap();
        let nets = list_networks(&mut conn).unwrap();
        assert_eq!(nets.len(), 1);
        assert_eq!(nets[0].ssid, "HomeWiFi");
        assert_eq!(nets[0].label, "Home");
    }

    #[test]
    fn upsert_network_same_ssid_updates_label() {
        let (_dir, mut conn) = temp_conn();
        upsert_network(
            &mut conn,
            NewNetwork {
                ssid: "HomeWiFi",
                label: "Old",
            },
        )
        .unwrap();
        upsert_network(
            &mut conn,
            NewNetwork {
                ssid: "HomeWiFi",
                label: "New",
            },
        )
        .unwrap();
        let nets = list_networks(&mut conn).unwrap();
        assert_eq!(nets.len(), 1);
        assert_eq!(nets[0].label, "New");
    }

    #[test]
    fn delete_network_removes_row() {
        let (_dir, mut conn) = temp_conn();
        upsert_network(
            &mut conn,
            NewNetwork {
                ssid: "HomeWiFi",
                label: "Home",
            },
        )
        .unwrap();
        delete_network(&mut conn, "HomeWiFi").unwrap();
        assert!(list_networks(&mut conn).unwrap().is_empty());
    }
}
