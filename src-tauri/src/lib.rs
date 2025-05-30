use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::State;
use tokio::sync::Mutex;
use urlencoding;

// Datenstrukturen für API-Kommunikation
#[derive(Debug, Serialize, Deserialize)]
pub struct ApiConfig {
    pub server_url: String,
    pub api_secret: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct EmbedData {
    pub title: Option<String>,
    pub description: Option<String>,
    pub color: Option<String>,
    pub thumbnail: Option<HashMap<String, String>>,
    pub image: Option<HashMap<String, String>>,
    pub footer: Option<HashMap<String, String>>,
    pub author: Option<HashMap<String, String>>,
    pub fields: Option<Vec<HashMap<String, serde_json::Value>>>,
    pub timestamp: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SendMessageRequest {
    pub channel_id: String,
    pub message: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SendEmbedRequest {
    pub channel_id: Option<String>,
    pub user_id: Option<String>,
    pub embed_data: EmbedData,
    pub message_type: String, // "channel" or "dm"
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ApiResponse {
    pub success: bool,
    pub message: Option<String>,
    pub data: Option<serde_json::Value>,
}

// Globaler Zustand für API-Konfiguration
pub struct AppState {
    pub api_config: Mutex<Option<ApiConfig>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            api_config: Mutex::new(None),
        }
    }
}

// HTTP Client für API-Aufrufe
async fn make_api_request(
    method: &str,
    url: &str,
    api_secret: &str,
    body: Option<String>,
) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::new();

    let mut request = match method {
        "GET" => client.get(url),
        "POST" => client.post(url),
        "PUT" => client.put(url),
        "DELETE" => client.delete(url),
        _ => return Err("Unsupported HTTP method".to_string()),
    };

    request = request
        .header("Content-Type", "application/json")
        .header("x-api-secret", api_secret);

    if let Some(body_content) = body {
        request = request.body(body_content);
    }

    let response = request
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let error_text = response
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error".to_string());
        return Err(format!("HTTP {}: {}", status, error_text));
    }

    let json: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse JSON: {}", e))?;

    Ok(json)
}

// Tauri Commands
#[tauri::command]
async fn set_api_config(
    server_url: String,
    api_secret: String,
    state: State<'_, AppState>,
) -> Result<ApiResponse, String> {
    let config = ApiConfig {
        server_url: server_url.trim_end_matches('/').to_string(),
        api_secret,
    };

    let mut api_config = state.api_config.lock().await;
    *api_config = Some(config);

    Ok(ApiResponse {
        success: true,
        message: Some("API configuration set successfully".to_string()),
        data: None,
    })
}

#[tauri::command]
async fn get_servers(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let api_config = state.api_config.lock().await;

    let config = api_config
        .as_ref()
        .ok_or("API not configured. Please set server URL and API secret first.")?;

    let url = format!("{}/api/servers", config.server_url);

    make_api_request("GET", &url, &config.api_secret, None).await
}

#[tauri::command]
async fn get_channels(server_id: String, state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let api_config = state.api_config.lock().await;

    let config = api_config
        .as_ref()
        .ok_or("API not configured")?;

    let url = format!("{}/api/channels/{}", config.server_url, server_id);

    make_api_request("GET", &url, &config.api_secret, None).await
}

#[tauri::command]
async fn search_users(query: String, state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let api_config = state.api_config.lock().await;

    let config = api_config
        .as_ref()
        .ok_or("API not configured")?;

    let url = format!("{}/api/users/search/{}", config.server_url,
                      urlencoding::encode(&query));

    make_api_request("GET", &url, &config.api_secret, None).await
}

#[tauri::command]
async fn send_simple_message(
    channel_id: Option<String>,
    user_id: Option<String>,
    message: String,
    state: State<'_, AppState>,
) -> Result<ApiResponse, String> {
    let api_config = state.api_config.lock().await;

    let config = api_config
        .as_ref()
        .ok_or("API not configured")?;

    let (endpoint, payload) = if let Some(channel_id) = channel_id {
        let payload = serde_json::json!({
            "channelId": channel_id,
            "message": message
        });
        ("/api/send-message", payload)
    } else if let Some(user_id) = user_id {
        let payload = serde_json::json!({
            "userId": user_id,
            "message": message
        });
        ("/api/send-dm", payload)
    } else {
        return Err("Either channel_id or user_id must be provided".to_string());
    };

    let url = format!("{}{}", config.server_url, endpoint);
    let body = serde_json::to_string(&payload)
        .map_err(|e| format!("Failed to serialize payload: {}", e))?;

    let response = make_api_request("POST", &url, &config.api_secret, Some(body)).await?;

    Ok(ApiResponse {
        success: true,
        message: Some("Message sent successfully".to_string()),
        data: Some(response),
    })
}

#[tauri::command]
async fn send_embed_message(
    channel_id: Option<String>,
    user_id: Option<String>,
    embed_data: EmbedData,
    state: State<'_, AppState>,
) -> Result<ApiResponse, String> {
    let api_config = state.api_config.lock().await;

    let config = api_config
        .as_ref()
        .ok_or("API not configured")?;

    let message_type = if channel_id.is_some() { "channel" } else { "dm" };

    let payload = serde_json::json!({
        "channelId": channel_id,
        "userId": user_id,
        "embedData": embed_data,
        "type": message_type
    });

    let url = format!("{}/api/send-embed", config.server_url);
    let body = serde_json::to_string(&payload)
        .map_err(|e| format!("Failed to serialize payload: {}", e))?;

    let response = make_api_request("POST", &url, &config.api_secret, Some(body)).await?;

    Ok(ApiResponse {
        success: true,
        message: Some("Embed message sent successfully".to_string()),
        data: Some(response),
    })
}

#[tauri::command]
async fn test_connection(state: State<'_, AppState>) -> Result<ApiResponse, String> {
    let api_config = state.api_config.lock().await;

    let config = api_config
        .as_ref()
        .ok_or("API not configured")?;

    let url = format!("{}/api/servers", config.server_url);

    match make_api_request("GET", &url, &config.api_secret, None).await {
        Ok(_) => Ok(ApiResponse {
            success: true,
            message: Some("Connection successful".to_string()),
            data: None,
        }),
        Err(e) => Err(format!("Connection failed: {}", e)),
    }
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            greet,
            set_api_config,
            get_servers,
            get_channels,
            search_users,
            send_simple_message,
            send_embed_message,
            test_connection
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}