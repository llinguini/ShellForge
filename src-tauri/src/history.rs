use rusqlite::{params, Connection, OptionalExtension};
use std::path::PathBuf;
use std::sync::Mutex;

pub struct HistoryStore {
    connection: Mutex<Connection>,
}

impl HistoryStore {
    pub fn new() -> Result<Self, String> {
        let path = history_db_path()?;
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| format!("failed to create history directory: {error}"))?;
        }

        let connection = Connection::open(path)
            .map_err(|error| format!("failed to open history database: {error}"))?;

        connection
            .execute_batch(
                r#"
                CREATE TABLE IF NOT EXISTS history (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  command TEXT NOT NULL,
                  cwd TEXT NOT NULL,
                  exit_code INTEGER,
                  ran_at INTEGER NOT NULL
                );

                CREATE UNIQUE INDEX IF NOT EXISTS history_command_unique
                ON history(command);
                "#,
            )
            .map_err(|error| format!("failed to initialize history database: {error}"))?;

        Ok(Self {
            connection: Mutex::new(connection),
        })
    }

    pub fn add_entry(&self, command: &str, cwd: &str, exit_code: i64) -> Result<(), String> {
        let command = command.trim();
        if command.is_empty() {
            return Ok(());
        }

        let connection = self
            .connection
            .lock()
            .map_err(|_| "history database lock is poisoned".to_string())?;

        let last_command = connection
            .query_row(
                "SELECT command FROM history ORDER BY id DESC LIMIT 1",
                [],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|error| format!("failed to read last history entry: {error}"))?;

        if last_command.as_deref() == Some(command) {
            return Ok(());
        }

        connection
            .execute(
                r#"
                INSERT INTO history (command, cwd, exit_code, ran_at)
                VALUES (?1, ?2, ?3, strftime('%s','now'))
                ON CONFLICT DO NOTHING
                "#,
                params![command, cwd, exit_code],
            )
            .map_err(|error| format!("failed to insert history entry: {error}"))?;

        connection
            .execute(
                r#"
                UPDATE history
                SET ran_at = strftime('%s','now'), cwd = ?2, exit_code = ?3
                WHERE command = ?1
                "#,
                params![command, cwd, exit_code],
            )
            .map_err(|error| format!("failed to update history entry: {error}"))?;

        Ok(())
    }

    pub fn suggestion(&self, prefix: &str, cwd: &str) -> Result<Option<String>, String> {
        if prefix.trim().is_empty() {
            return Ok(None);
        }

        let connection = self
            .connection
            .lock()
            .map_err(|_| "history database lock is poisoned".to_string())?;
        let like_pattern = format!("{prefix}%");

        connection
            .query_row(
                r#"
                SELECT command FROM history
                WHERE command LIKE ?1
                ORDER BY
                  CASE WHEN cwd = ?2 THEN 0 ELSE 1 END,
                  ran_at DESC
                LIMIT 1
                "#,
                params![like_pattern, cwd],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|error| format!("failed to query history suggestion: {error}"))
    }

    pub fn filtered_suggestions(
        &self,
        prefix: &str,
        cwd: &str,
        limit: i64,
    ) -> Result<Vec<String>, String> {
        if prefix.trim().is_empty() {
            return Ok(Vec::new());
        }

        let limit = limit.clamp(1, 50);
        let connection = self
            .connection
            .lock()
            .map_err(|_| "history database lock is poisoned".to_string())?;
        let like_pattern = format!("{prefix}%");
        let mut statement = connection
            .prepare(
                r#"
                SELECT command FROM history
                WHERE command LIKE ?1
                ORDER BY
                  CASE WHEN cwd = ?2 THEN 0 ELSE 1 END,
                  ran_at DESC
                LIMIT ?3
                "#,
            )
            .map_err(|error| format!("failed to prepare history suggestions query: {error}"))?;

        let rows = statement
            .query_map(params![like_pattern, cwd, limit], |row| {
                row.get::<_, String>(0)
            })
            .map_err(|error| format!("failed to query history suggestions: {error}"))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("failed to collect history suggestions: {error}"))
    }
}

fn history_db_path() -> Result<PathBuf, String> {
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or_else(|| "HOME is not set".to_string())?;

    Ok(home.join(".shellforge").join("history.db"))
}
