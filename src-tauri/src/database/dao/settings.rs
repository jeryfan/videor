//! 通用设置数据访问对象
//!
//! 提供键值对形式的通用设置存储。

use crate::database::{lock_conn, Database};
use crate::error::AppError;
use rusqlite::params;

impl Database {
    /// 获取设置值
    pub fn get_setting(&self, key: &str) -> Result<Option<String>, AppError> {
        let conn = lock_conn!(self.conn);
        let mut stmt = conn
            .prepare("SELECT value FROM settings WHERE key = ?1")
            .map_err(|e| AppError::Database(e.to_string()))?;

        let mut rows = stmt
            .query(params![key])
            .map_err(|e| AppError::Database(e.to_string()))?;

        if let Some(row) = rows.next().map_err(|e| AppError::Database(e.to_string()))? {
            Ok(Some(
                row.get(0).map_err(|e| AppError::Database(e.to_string()))?,
            ))
        } else {
            Ok(None)
        }
    }

    /// 以布尔语义读取 flag：`"true"` 或 `"1"` → true，其它全部 false。
    pub fn get_bool_flag(&self, key: &str) -> Result<bool, AppError> {
        Ok(matches!(
            self.get_setting(key)?.as_deref(),
            Some("true") | Some("1")
        ))
    }

    /// 设置值
    pub fn set_setting(&self, key: &str, value: &str) -> Result<(), AppError> {
        let conn = lock_conn!(self.conn);
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
            params![key, value],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(())
    }

    // --- 全局出站代理 ---

    /// 全局代理 URL 的存储键名
    const GLOBAL_PROXY_URL_KEY: &'static str = "global_proxy_url";

    /// 获取全局出站代理 URL
    ///
    /// 返回 None 表示未配置或已清除代理（直连）
    /// 返回 Some(url) 表示已配置代理
    pub fn get_global_proxy_url(&self) -> Result<Option<String>, AppError> {
        self.get_setting(Self::GLOBAL_PROXY_URL_KEY)
    }

    /// 设置全局出站代理 URL
    ///
    /// - 传入非空字符串：启用代理
    /// - 传入空字符串或 None：清除代理设置（直连）
    pub fn set_global_proxy_url(&self, url: Option<&str>) -> Result<(), AppError> {
        match url {
            Some(u) if !u.trim().is_empty() => {
                self.set_setting(Self::GLOBAL_PROXY_URL_KEY, u.trim())
            }
            _ => {
                let conn = lock_conn!(self.conn);
                conn.execute(
                    "DELETE FROM settings WHERE key = ?1",
                    params![Self::GLOBAL_PROXY_URL_KEY],
                )
                .map_err(|e| AppError::Database(e.to_string()))?;
                Ok(())
            }
        }
    }
}
