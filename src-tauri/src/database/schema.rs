//! Schema 定义和迁移
//!
//! 负责数据库表结构的创建和版本迁移。

use super::{lock_conn, Database, SCHEMA_VERSION};
use crate::error::AppError;
use rusqlite::Connection;

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
                    .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
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
                    .map_err(|e| {
                        AppError::Database(format!("删除旧表 {table} 失败: {e}"))
                    })?;
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
            conn.execute(
                &format!("PRAGMA user_version = {SCHEMA_VERSION};"),
                [],
            )
            .map_err(|e| AppError::Database(format!("设置 user_version 失败: {e}")))?;
            log::info!("数据库降级重建完成，保留了 {} 条基础设置", preserved.len());
            return Ok(());
        }

        // SCHEMA_VERSION = 0，无需迁移
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
