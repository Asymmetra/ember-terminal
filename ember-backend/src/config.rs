#[allow(dead_code)]
pub struct AppConfig {
    pub api_url: String,
    pub ws_url: String,
    pub api_key: Option<String>,
    pub port: u16,
}

impl AppConfig {
    pub fn from_env() -> Self {
        Self {
            api_url: std::env::var("PHOENIX_API_URL")
                .unwrap_or_else(|_| "https://perp-api.phoenix.trade".to_string()),
            ws_url: std::env::var("PHOENIX_WS_URL")
                .unwrap_or_else(|_| "wss://perp-api.phoenix.trade/ws".to_string()),
            api_key: std::env::var("PHOENIX_API_KEY").ok(),
            port: std::env::var("PORT")
                .ok()
                .and_then(|p| p.parse().ok())
                .unwrap_or(3001),
        }
    }
}
