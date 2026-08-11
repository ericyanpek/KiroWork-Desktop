use serde::Serialize;

#[derive(Debug, Clone, Serialize, thiserror::Error)]
#[serde(tag = "kind")]
pub enum AppError {
    #[serde(rename = "kiro_not_found")]
    #[error("kiro-cli not found: {message}")]
    KiroNotFound { message: String },

    #[serde(rename = "auth_required")]
    #[error("auth required: {message}")]
    AuthRequired { message: String },

    #[serde(rename = "acp_connection_failed")]
    #[error("acp connection failed: {message}")]
    AcpConnectionFailed { message: String },

    #[serde(rename = "acp_timeout")]
    #[error("acp timeout: {message}")]
    AcpTimeout { message: String },

    #[serde(rename = "session_error")]
    #[error("session error: {message}")]
    SessionError { message: String },

    #[serde(rename = "workspace_error")]
    #[error("workspace error: {message}")]
    WorkspaceError { message: String },

    #[serde(rename = "unknown")]
    #[error("unknown error: {message}")]
    Unknown { message: String },
}

pub type AppResult<T> = Result<T, AppError>;

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        AppError::Unknown {
            message: e.to_string(),
        }
    }
}

impl From<serde_json::Error> for AppError {
    fn from(e: serde_json::Error) -> Self {
        AppError::Unknown {
            message: e.to_string(),
        }
    }
}

impl From<anyhow::Error> for AppError {
    fn from(e: anyhow::Error) -> Self {
        AppError::Unknown {
            message: e.to_string(),
        }
    }
}
