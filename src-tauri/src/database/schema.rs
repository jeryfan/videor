//! Schema 定义和迁移
//!
//! 负责数据库表结构的创建和版本迁移。

use super::{lock_conn, Database, SCHEMA_VERSION};
use crate::error::AppError;
use rusqlite::{params, Connection};

impl Database {
    /// 创建所有数据库表
    pub(crate) fn create_tables(&self) -> Result<(), AppError> {
        let conn = lock_conn!(self.conn);
        Self::create_tables_on_conn(&conn)
    }

    /// 在指定连接上创建表（供迁移和测试使用）
    pub(crate) fn create_tables_on_conn(conn: &Connection) -> Result<(), AppError> {
        conn.execute(
            "CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)",
            [],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;

        // 下载任务主表 (v1)
        conn.execute(
            "CREATE TABLE IF NOT EXISTS download_tasks (
                id TEXT PRIMARY KEY,
                type TEXT NOT NULL CHECK(type IN ('single', 'batch')),
                title TEXT NOT NULL,
                source TEXT NOT NULL,
                resource_key TEXT,
                status TEXT NOT NULL,
                progress INTEGER NOT NULL DEFAULT 0,
                speed INTEGER NOT NULL DEFAULT 0,
                error TEXT,
                file_path TEXT,
                directory_path TEXT,
                expanded INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            )",
            [],
        )
        .map_err(|e| AppError::Database(format!("创建 download_tasks 表失败: {e}")))?;

        // 下载任务子项表 (v1)
        conn.execute(
            "CREATE TABLE IF NOT EXISTS download_items (
                id TEXT PRIMARY KEY,
                task_id TEXT NOT NULL REFERENCES download_tasks(id) ON DELETE CASCADE,
                title TEXT NOT NULL,
                url TEXT NOT NULL,
                order_num INTEGER NOT NULL DEFAULT 0,
                task_id_ref TEXT,
                status TEXT NOT NULL,
                progress INTEGER NOT NULL DEFAULT 0,
                speed INTEGER NOT NULL DEFAULT 0,
                error TEXT,
                file_path TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            )",
            [],
        )
        .map_err(|e| AppError::Database(format!("创建 download_items 表失败: {e}")))?;

        // 为批量任务查询优化索引
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_download_items_task_id ON download_items(task_id)",
            [],
        )
        .map_err(|e| AppError::Database(format!("创建索引失败: {e}")))?;

        Ok(())
    }

    /// 应用 Schema 迁移
    pub(crate) fn apply_schema_migrations(&self) -> Result<(), AppError> {
        let conn = lock_conn!(self.conn);
        Self::apply_schema_migrations_on_conn(&conn)
    }

    /// 在指定连接上应用 Schema 迁移
    pub(crate) fn apply_schema_migrations_on_conn(conn: &Connection) -> Result<(), AppError> {
        let version = Self::get_user_version(conn)?;

        if version > SCHEMA_VERSION {
            log::warn!(
                "检测到旧版本数据库（user_version={version} > {SCHEMA_VERSION}），执行降级重建..."
            );
            // 保留基础设置
            let mut preserved: Vec<(String, String)> = Vec::new();
            if Self::table_exists(conn, "settings")? {
                let mut stmt = conn
                    .prepare("SELECT key, value FROM settings WHERE key IN ('language', 'theme')")
                    .map_err(|e| AppError::Database(e.to_string()))?;
                let rows = stmt
                    .query_map([], |row| {
                        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                    })
                    .map_err(|e| AppError::Database(e.to_string()))?;
                for row in rows {
                    preserved.push(row.map_err(|e| AppError::Database(e.to_string()))?);
                }
            }
            // 删除所有旧表
            let tables: Vec<String> = conn
                .prepare("SELECT name FROM sqlite_master WHERE type='table'")
                .map_err(|e| AppError::Database(e.to_string()))?
                .query_map([], |row| row.get(0))
                .map_err(|e| AppError::Database(e.to_string()))?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| AppError::Database(e.to_string()))?;
            for table in tables {
                if table == "sqlite_sequence" {
                    continue;
                }
                conn.execute(&format!("DROP TABLE IF EXISTS {table}"), [])
                    .map_err(|e| AppError::Database(format!("删除旧表 {table} 失败: {e}")))?;
            }
            // 重建表
            Self::create_tables_on_conn(conn)?;
            // 恢复基础设置
            for (key, value) in &preserved {
                conn.execute(
                    "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
                    [&key, &value],
                )
                .map_err(|e| AppError::Database(e.to_string()))?;
            }
            // 更新版本号
            conn.execute(&format!("PRAGMA user_version = {SCHEMA_VERSION};"), [])
                .map_err(|e| AppError::Database(format!("设置 user_version 失败: {e}")))?;
            log::info!("数据库降级重建完成，保留了 {} 条基础设置", preserved.len());
            return Ok(());
        }

        // v0 -> v1: 迁移下载历史到独立表
        if version == 0 && SCHEMA_VERSION >= 1 {
            Self::migrate_v0_to_v1_download_history(conn)?;
            conn.execute("PRAGMA user_version = 1;", [])
                .map_err(|e| AppError::Database(format!("设置 user_version 失败: {e}")))?;
            log::info!("数据库迁移完成: v0 -> v1 (下载历史表)");
        }

        Ok(())
    }

    /// v0 -> v1 迁移：将 settings 表中的下载历史 JSON 迁移到独立表
    fn migrate_v0_to_v1_download_history(conn: &Connection) -> Result<(), AppError> {
        let old_json: Option<String> = match conn.query_row(
            "SELECT value FROM settings WHERE key = 'download_history_state'",
            [],
            |row| row.get::<_, String>(0),
        ) {
            Ok(v) => Some(v),
            Err(rusqlite::Error::QueryReturnedNoRows) => None,
            Err(e) => return Err(AppError::Database(format!("读取旧下载历史失败: {e}"))),
        };

        let Some(old_json) = old_json else {
            return Ok(());
        };

        let history: serde_json::Value = match serde_json::from_str(&old_json) {
            Ok(v) => v,
            Err(e) => {
                log::warn!("旧下载历史 JSON 解析失败，跳过迁移: {e}");
                return Ok(());
            }
        };

        let mut tasks: Vec<serde_json::Value> = history
            .get("tasks")
            .and_then(|v| v.as_array())
            .map(|arr| arr.to_vec())
            .unwrap_or_default();

        if tasks.is_empty() {
            // 尝试旧格式
            if let Some(single) = history.get("singleDownloadTask") {
                tasks.push(single.clone());
            }
            if let Some(items) = history.get("batchDownloadItems").and_then(|v| v.as_array()) {
                if !items.is_empty() {
                    let mut batch = serde_json::Map::new();
                    batch.insert("id".to_string(), serde_json::Value::String(format!("batch_{}", chrono::Utc::now().timestamp_millis())));
                    batch.insert("type".to_string(), serde_json::Value::String("batch".to_string()));
                    batch.insert("title".to_string(), history.get("batchDownloadTitle").cloned().unwrap_or_else(|| serde_json::Value::String("Bilibili 批量下载".to_string())));
                    batch.insert("source".to_string(), serde_json::Value::String("bilibili".to_string()));
                    batch.insert("status".to_string(), serde_json::Value::String("cancelled".to_string()));
                    batch.insert("progress".to_string(), serde_json::Value::Number(0.into()));
                    batch.insert("speed".to_string(), serde_json::Value::Number(0.into()));
                    batch.insert("items".to_string(), serde_json::Value::Array(items.to_vec()));
                    batch.insert("createdAt".to_string(), serde_json::Value::Number(chrono::Utc::now().timestamp_millis().into()));
                    batch.insert("updatedAt".to_string(), serde_json::Value::Number(chrono::Utc::now().timestamp_millis().into()));
                    tasks.push(serde_json::Value::Object(batch));
                }
            }
            if tasks.is_empty() {
                return Ok(());
            }
        }

        for task in &tasks {
            if let Err(e) = Self::migrate_v0_task(conn, &task) {
                log::warn!("迁移单个下载任务失败: {e}");
            }
        }

        // 删除旧数据
        if let Err(e) = conn.execute(
            "DELETE FROM settings WHERE key = 'download_history_state'",
            [],
        ) {
            log::warn!("删除旧下载历史 settings 键失败: {e}");
        }

        log::info!("下载历史迁移完成: {} 个任务", tasks.len());
        Ok(())
    }

    fn migrate_v0_task(conn: &Connection, task: &serde_json::Value) -> Result<(), AppError> {
        let id = task.get("id").and_then(|v| v.as_str()).unwrap_or_default();
        let task_type = task.get("type").and_then(|v| v.as_str()).unwrap_or("single");
        let title = task.get("title").and_then(|v| v.as_str()).unwrap_or("");
        let source = task.get("source").and_then(|v| v.as_str()).unwrap_or("other");
        let resource_key = task.get("resourceKey").and_then(|v| v.as_str());
        let status = task.get("status").and_then(|v| v.as_str()).unwrap_or("cancelled");
        let progress = task.get("progress").and_then(|v| v.as_u64()).unwrap_or(0) as i64;
        let speed = task.get("speed").and_then(|v| v.as_u64()).unwrap_or(0) as i64;
        let error = task.get("error").and_then(|v| v.as_str());
        let file_path = task.get("filePath").and_then(|v| v.as_str());
        let directory_path = task.get("directoryPath").and_then(|v| v.as_str());
        let expanded = task.get("expanded").and_then(|v| v.as_bool()).unwrap_or(false);
        let created_at = task.get("createdAt").and_then(|v| v.as_i64()).unwrap_or_else(|| chrono::Utc::now().timestamp_millis());
        let updated_at = task.get("updatedAt").and_then(|v| v.as_i64()).unwrap_or(created_at);

        if id.is_empty() || title.is_empty() {
            return Err(AppError::Database("任务 ID 或标题为空".to_string()));
        }

        conn.execute(
            "INSERT OR REPLACE INTO download_tasks
             (id, type, title, source, resource_key, status, progress, speed, error, file_path, directory_path, expanded, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
            params![
                id, task_type, title, source, resource_key, status, progress, speed,
                error, file_path, directory_path, expanded as i32, created_at, updated_at
            ],
        )
        .map_err(|e| AppError::Database(format!("插入任务失败: {e}")))?;

        // 迁移子项
        if let Some(items) = task.get("items").and_then(|v| v.as_array()) {
            for item in items {
                let item_id = item.get("id").and_then(|v| v.as_str()).unwrap_or_default();
                let item_title = item.get("title").and_then(|v| v.as_str()).unwrap_or("");
                let url = item.get("url").and_then(|v| v.as_str()).unwrap_or("");
                let order_num = item.get("order").and_then(|v| v.as_u64()).unwrap_or(0) as i64;
                let task_id_ref = item.get("taskId").and_then(|v| v.as_str());
                let item_status = item.get("status").and_then(|v| v.as_str()).unwrap_or("cancelled");
                let item_progress = item.get("progress").and_then(|v| v.as_u64()).unwrap_or(0) as i64;
                let item_speed = item.get("speed").and_then(|v| v.as_u64()).unwrap_or(0) as i64;
                let item_error = item.get("error").and_then(|v| v.as_str());
                let item_file_path = item.get("filePath").and_then(|v| v.as_str());

                if item_id.is_empty() {
                    continue;
                }

                conn.execute(
                    "INSERT OR REPLACE INTO download_items
                     (id, task_id, title, url, order_num, task_id_ref, status, progress, speed, error, file_path, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
                    params![
                        item_id, id, item_title, url, order_num, task_id_ref,
                        item_status, item_progress, item_speed, item_error, item_file_path,
                        created_at, updated_at
                    ],
                )
                .map_err(|e| AppError::Database(format!("插入子项失败: {e}")))?;
            }
        }

        Ok(())
    }

    pub(crate) fn get_user_version(conn: &Connection) -> Result<i32, AppError> {
        conn.query_row("PRAGMA user_version;", [], |row| row.get(0))
            .map_err(|e| AppError::Database(format!("读取 user_version 失败: {e}")))
    }

    pub(crate) fn table_exists(conn: &Connection, table: &str) -> Result<bool, AppError> {
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
                [table],
                |row| row.get(0),
            )
            .map_err(|e| AppError::Database(format!("检查表存在失败: {e}")))?;
        Ok(count > 0)
    }
}
