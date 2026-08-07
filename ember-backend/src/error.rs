use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde_json::json;
use thiserror::Error;

#[derive(Error, Debug)]
#[allow(dead_code)]
pub enum AppError {
    #[error("Market not found: {0}")]
    MarketNotFound(String),

    #[error("Invalid request: {0}")]
    BadRequest(String),

    #[error("Phoenix SDK error: {0}")]
    Phoenix(String),

    // Message starts with "rate_limited:" so clients can detect + back off.
    #[error("rate_limited: {0}")]
    RateLimited(String),

    #[error("Not found: {0}")]
    NotFound(String),

    #[error("Internal error: {0}")]
    Internal(String),
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, message) = match &self {
            AppError::MarketNotFound(_) => (StatusCode::NOT_FOUND, self.to_string()),
            AppError::BadRequest(_) => (StatusCode::BAD_REQUEST, self.to_string()),
            AppError::Phoenix(_) => (StatusCode::BAD_GATEWAY, self.to_string()),
            AppError::RateLimited(_) => (StatusCode::TOO_MANY_REQUESTS, self.to_string()),
            AppError::NotFound(_) => (StatusCode::NOT_FOUND, self.to_string()),
            AppError::Internal(_) => (StatusCode::INTERNAL_SERVER_ERROR, self.to_string()),
        };

        let body = json!({ "error": message });
        (status, axum::Json(body)).into_response()
    }
}
