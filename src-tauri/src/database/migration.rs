//! JSON → SQLite 数据迁移
//!
//! AI 相关迁移已移除（功能降级）。

use super::Database;
use crate::error::AppError;

impl Database {
    /// 从旧版 config.json 迁移数据到数据库
    pub fn migrate_from_json(&self, _config: &serde_json::Value) -> Result<(), AppError> {
        Ok(())
    }

    /// 运行迁移的 dry-run 模式
    pub fn migrate_from_json_dry_run(_config: &serde_json::Value) -> Result<(), AppError> {
        Ok(())
    }
}
