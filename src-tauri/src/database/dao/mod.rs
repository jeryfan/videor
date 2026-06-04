//! Data Access Object layer
//!
//! Database access operations for each domain

pub mod download_history;
pub mod settings;

// 所有 DAO 方法都通过 Database impl 提供，无需单独导出
