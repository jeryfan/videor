//! 下载历史数据访问对象
//!
//! 提供下载任务和子项的增删改查。

use crate::database::{lock_conn, Database};
use crate::error::AppError;
use rusqlite::params;
use serde::{Deserialize, Serialize};

/// 前端兼容的下载历史格式
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadHistoryState {
    #[serde(default)]
    pub tasks: Vec<DownloadHistoryTask>,
    #[serde(default)]
    pub updated_at: i64,
}

/// 下载任务（与前端 DownloadHistoryTask 对应）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadHistoryTask {
    pub id: String,
    #[serde(rename = "type")]
    pub task_type: String,
    pub title: String,
    pub source: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resource_key: Option<String>,
    pub status: String,
    pub progress: u64,
    pub speed: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub directory_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub items: Option<Vec<DownloadHistoryItem>>,
    #[serde(default)]
    pub expanded: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

/// 下载子项（与前端 BatchDownloadItem 对应）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadHistoryItem {
    pub id: String,
    pub title: String,
    pub url: String,
    pub order: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub task_id: Option<String>,
    pub status: String,
    pub progress: u64,
    pub speed: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_path: Option<String>,
}

impl Database {
    /// 获取所有下载历史任务（带子项）
    pub fn get_download_history(&self) -> Result<DownloadHistoryState, AppError> {
        let conn = lock_conn!(self.conn);
        let mut stmt = conn
            .prepare(
                "SELECT id, type, title, source, resource_key, status, progress, speed,
                        error, file_path, directory_path, expanded, created_at, updated_at
                 FROM download_tasks
                 ORDER BY created_at DESC"
            )
            .map_err(|e| AppError::Database(format!("查询下载任务失败: {e}")))?;

        let tasks: Vec<DownloadHistoryTask> = stmt
            .query_map([], |row| {
                let task_type: String = row.get(1)?;
                let id: String = row.get(0)?;
                let mut task = DownloadHistoryTask {
                    id: id.clone(),
                    task_type,
                    title: row.get(2)?,
                    source: row.get(3)?,
                    resource_key: row.get(4)?,
                    status: row.get(5)?,
                    progress: row.get::<_, i64>(6)? as u64,
                    speed: row.get::<_, i64>(7)? as u64,
                    error: row.get(8)?,
                    file_path: row.get(9)?,
                    directory_path: row.get(10)?,
                    items: None,
                    expanded: row.get::<_, i32>(11)? != 0,
                    created_at: row.get(12)?,
                    updated_at: row.get(13)?,
                };

                // 批量任务加载子项
                if task.task_type == "batch" {
                    task.items = Self::get_task_items_on_conn(&conn, &id).ok();
                }

                Ok(task)
            })
            .map_err(|e| AppError::Database(format!("映射下载任务失败: {e}")))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| AppError::Database(format!("读取下载任务失败: {e}")))?;

        Ok(DownloadHistoryState {
            updated_at: chrono::Utc::now().timestamp_millis(),
            tasks,
        })
    }

    fn get_task_items_on_conn(
        conn: &rusqlite::Connection,
        task_id: &str,
    ) -> Result<Vec<DownloadHistoryItem>, AppError> {
        let mut stmt = conn
            .prepare(
                "SELECT id, title, url, order_num, task_id_ref, status, progress, speed, error, file_path
                 FROM download_items
                 WHERE task_id = ?1
                 ORDER BY order_num ASC"
            )
            .map_err(|e| AppError::Database(format!("查询下载子项失败: {e}")))?;

        let items: Vec<DownloadHistoryItem> = stmt
            .query_map([task_id], |row| {
                Ok(DownloadHistoryItem {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    url: row.get(2)?,
                    order: row.get::<_, i64>(3)? as u64,
                    task_id: row.get(4)?,
                    status: row.get(5)?,
                    progress: row.get::<_, i64>(6)? as u64,
                    speed: row.get::<_, i64>(7)? as u64,
                    error: row.get(8)?,
                    file_path: row.get(9)?,
                })
            })
            .map_err(|e| AppError::Database(format!("映射下载子项失败: {e}")))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| AppError::Database(format!("读取下载子项失败: {e}")))?;

        Ok(items)
    }

    /// 完整替换保存下载历史（事务）
    pub fn save_download_history(&self, state: &DownloadHistoryState) -> Result<(), AppError> {
        let mut conn = lock_conn!(self.conn);
        let tx = conn
            .transaction()
            .map_err(|e| AppError::Database(format!("开始事务失败: {e}")))?;

        // 清空旧数据
        tx.execute("DELETE FROM download_items", [])
            .map_err(|e| AppError::Database(format!("清空子项失败: {e}")))?;
        tx.execute("DELETE FROM download_tasks", [])
            .map_err(|e| AppError::Database(format!("清空任务失败: {e}")))?;

        // 插入新数据
        for task in &state.tasks {
            Self::insert_task_in_tx(&tx, task)?;
        }

        tx.commit()
            .map_err(|e| AppError::Database(format!("提交下载历史失败: {e}")))?;

        Ok(())
    }

    /// 删除单个任务及其子项
    pub fn delete_download_task(&self, task_id: &str) -> Result<(), AppError> {
        let conn = lock_conn!(self.conn);
        conn.execute(
            "DELETE FROM download_tasks WHERE id = ?1",
            params![task_id],
        )
        .map_err(|e| AppError::Database(format!("删除下载任务失败: {e}")))?;
        Ok(())
    }

    /// 清空所有下载历史
    pub fn clear_download_history(&self) -> Result<(), AppError> {
        let mut conn = lock_conn!(self.conn);
        let tx = conn
            .transaction()
            .map_err(|e| AppError::Database(format!("开始事务失败: {e}")))?;
        tx.execute("DELETE FROM download_items", [])
            .map_err(|e| AppError::Database(format!("清空子项失败: {e}")))?;
        tx.execute("DELETE FROM download_tasks", [])
            .map_err(|e| AppError::Database(format!("清空任务失败: {e}")))?;
        tx.commit()
            .map_err(|e| AppError::Database(format!("提交清空操作失败: {e}")))?;
        Ok(())
    }

    fn insert_task_in_tx(
        tx: &rusqlite::Transaction,
        task: &DownloadHistoryTask,
    ) -> Result<(), AppError> {
        tx.execute(
            "INSERT OR REPLACE INTO download_tasks
             (id, type, title, source, resource_key, status, progress, speed, error, file_path, directory_path, expanded, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
            params![
                &task.id,
                &task.task_type,
                &task.title,
                &task.source,
                &task.resource_key,
                &task.status,
                task.progress as i64,
                task.speed as i64,
                &task.error,
                &task.file_path,
                &task.directory_path,
                task.expanded as i32,
                task.created_at,
                task.updated_at
            ],
        )
        .map_err(|e| AppError::Database(format!("插入任务失败: {e}")))?;

        if let Some(items) = &task.items {
            for item in items {
                tx.execute(
                    "INSERT OR REPLACE INTO download_items
                     (id, task_id, title, url, order_num, task_id_ref, status, progress, speed, error, file_path, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
                    params![
                        &item.id,
                        &task.id,
                        &item.title,
                        &item.url,
                        item.order as i64,
                        &item.task_id,
                        &item.status,
                        item.progress as i64,
                        item.speed as i64,
                        &item.error,
                        &item.file_path,
                        task.created_at,
                        task.updated_at
                    ],
                )
                .map_err(|e| AppError::Database(format!("插入子项失败: {e}")))?;
            }
        }

        Ok(())
    }
}
