use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use rusqlite::types::ValueRef;
use rusqlite::{params_from_iter, Connection};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Number, Value as Json};
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Manager, State};

const DB_FILE: &str = "budget.sqlite3";
const SQLITE_HEADER: &[u8] = b"SQLite format 3";

#[derive(Default)]
pub struct DbState(pub Mutex<DbInner>);

#[derive(Default)]
pub struct DbInner {
    conn: Option<Connection>,
    path: Option<PathBuf>,
}

impl DbInner {
    fn conn(&self) -> Result<&Connection, String> {
        self.conn
            .as_ref()
            .ok_or_else(|| "Database not opened.".to_string())
    }
}

#[derive(Serialize)]
pub struct DbInfo {
    path: String,
}

#[derive(Serialize)]
pub struct ExecuteResult {
    #[serde(rename = "rowsAffected")]
    rows_affected: u64,
}

#[derive(Deserialize)]
pub struct Statement {
    sql: String,
    #[serde(default)]
    params: Option<Vec<Json>>,
}

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

fn open_conn(path: &Path) -> Result<Connection, String> {
    let conn = Connection::open(path).map_err(err)?;
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA foreign_keys = ON;
         PRAGMA busy_timeout = 5000;",
    )
    .map_err(err)?;
    Ok(conn)
}

fn to_sql(value: &Json) -> Result<rusqlite::types::Value, String> {
    use rusqlite::types::Value;
    Ok(match value {
        Json::Null => Value::Null,
        Json::Bool(b) => Value::Integer(i64::from(*b)),
        Json::Number(n) => {
            if let Some(i) = n.as_i64() {
                Value::Integer(i)
            } else if let Some(f) = n.as_f64() {
                Value::Real(f)
            } else {
                return Err(format!("Unsupported numeric parameter: {n}"));
            }
        }
        Json::String(s) => Value::Text(s.clone()),
        // Uint8Array crosses the IPC boundary as an array of byte values.
        Json::Array(items) => {
            let mut bytes = Vec::with_capacity(items.len());
            for item in items {
                let byte = item
                    .as_u64()
                    .filter(|v| *v <= u64::from(u8::MAX))
                    .ok_or_else(|| "Blob parameters must be arrays of bytes.".to_string())?;
                bytes.push(byte as u8);
            }
            Value::Blob(bytes)
        }
        Json::Object(_) => return Err("Object parameters are not supported.".to_string()),
    })
}

fn bind(params: Option<Vec<Json>>) -> Result<Vec<rusqlite::types::Value>, String> {
    params
        .unwrap_or_default()
        .iter()
        .map(to_sql)
        .collect::<Result<Vec<_>, _>>()
}

fn from_sql(value: ValueRef<'_>) -> Json {
    match value {
        ValueRef::Null => Json::Null,
        ValueRef::Integer(i) => Json::Number(Number::from(i)),
        ValueRef::Real(f) => Number::from_f64(f).map_or(Json::Null, Json::Number),
        ValueRef::Text(t) => Json::String(String::from_utf8_lossy(t).into_owned()),
        ValueRef::Blob(b) => Json::Array(b.iter().map(|v| Json::Number(Number::from(*v))).collect()),
    }
}

fn query(conn: &Connection, sql: &str, params: Option<Vec<Json>>) -> Result<Vec<Json>, String> {
    let mut stmt = conn.prepare(sql).map_err(err)?;
    let columns: Vec<String> = stmt.column_names().iter().map(|c| (*c).to_string()).collect();
    let values = bind(params)?;
    let mut rows = stmt.query(params_from_iter(values)).map_err(err)?;

    let mut out = Vec::new();
    while let Some(row) = rows.next().map_err(err)? {
        let mut object = Map::with_capacity(columns.len());
        for (index, name) in columns.iter().enumerate() {
            object.insert(name.clone(), from_sql(row.get_ref(index).map_err(err)?));
        }
        out.push(Json::Object(object));
    }
    Ok(out)
}

fn run(conn: &Connection, sql: &str, params: Option<Vec<Json>>) -> Result<u64, String> {
    let values = bind(params)?;
    if values.is_empty() {
        // execute_batch tolerates the multi-statement DDL used by migrations.
        conn.execute_batch(sql).map_err(err)?;
        Ok(conn.changes())
    } else {
        conn.execute(sql, params_from_iter(values))
            .map(|n| n as u64)
            .map_err(err)
    }
}

#[tauri::command]
pub fn db_open(app: AppHandle, state: State<'_, DbState>) -> Result<DbInfo, String> {
    let mut guard = state.0.lock().map_err(err)?;
    if let Some(path) = &guard.path {
        if guard.conn.is_some() {
            return Ok(DbInfo {
                path: path.display().to_string(),
            });
        }
    }

    let dir = app.path().app_data_dir().map_err(err)?;
    fs::create_dir_all(&dir).map_err(err)?;
    let path = dir.join(DB_FILE);
    guard.conn = Some(open_conn(&path)?);
    let info = DbInfo {
        path: path.display().to_string(),
    };
    guard.path = Some(path);
    Ok(info)
}

#[tauri::command]
pub fn db_select(
    state: State<'_, DbState>,
    sql: String,
    params: Option<Vec<Json>>,
) -> Result<Vec<Json>, String> {
    let guard = state.0.lock().map_err(err)?;
    query(guard.conn()?, &sql, params)
}

#[tauri::command]
pub fn db_execute(
    state: State<'_, DbState>,
    sql: String,
    params: Option<Vec<Json>>,
) -> Result<ExecuteResult, String> {
    let guard = state.0.lock().map_err(err)?;
    let rows_affected = run(guard.conn()?, &sql, params)?;
    Ok(ExecuteResult { rows_affected })
}

#[tauri::command]
pub fn db_batch(state: State<'_, DbState>, statements: Vec<Statement>) -> Result<(), String> {
    let guard = state.0.lock().map_err(err)?;
    let conn = guard.conn()?;
    let tx = conn.unchecked_transaction().map_err(err)?;
    for statement in statements {
        run(&tx, &statement.sql, statement.params)?;
    }
    tx.commit().map_err(err)
}

#[tauri::command]
pub fn db_export(state: State<'_, DbState>) -> Result<Response, String> {
    let guard = state.0.lock().map_err(err)?;
    let conn = guard.conn()?;
    let path = guard.path.as_ref().ok_or("Database not opened.")?;

    // VACUUM INTO yields a consistent copy even with a live WAL.
    let temp = path.with_extension("export-tmp");
    let _ = fs::remove_file(&temp);
    let target = temp.to_str().ok_or("Unsupported export path.")?;
    conn.execute("VACUUM INTO ?1", [target]).map_err(err)?;

    let bytes = fs::read(&temp).map_err(err)?;
    let _ = fs::remove_file(&temp);
    Ok(Response::new(bytes))
}

#[tauri::command]
pub fn db_import(request: Request<'_>, state: State<'_, DbState>) -> Result<(), String> {
    let bytes = match request.body() {
        InvokeBody::Raw(bytes) => bytes,
        InvokeBody::Json(_) => return Err("Expected raw bytes.".to_string()),
    };
    if bytes.len() < SQLITE_HEADER.len() || &bytes[..SQLITE_HEADER.len()] != SQLITE_HEADER {
        return Err("That file is not a SQLite database.".to_string());
    }

    let mut guard = state.0.lock().map_err(err)?;
    let path = guard.path.clone().ok_or("Database not opened.")?;

    // Stage the replacement before closing, so a failed write can never destroy the live ledger.
    let staged = path.with_extension("import-tmp");
    fs::write(&staged, bytes).map_err(err)?;

    if let Some(conn) = guard.conn.take() {
        conn.close().map_err(|(_, e)| err(e))?;
    }
    for suffix in ["-wal", "-shm"] {
        let _ = fs::remove_file(PathBuf::from(format!("{}{suffix}", path.display())));
    }
    let result = fs::rename(&staged, &path).map_err(err);
    guard.conn = Some(open_conn(&path)?);
    result
}

#[tauri::command]
pub fn db_close(state: State<'_, DbState>) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(err)?;
    if let Some(conn) = guard.conn.take() {
        conn.close().map_err(|(_, e)| err(e))?;
    }
    Ok(())
}
