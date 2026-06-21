use serde::Serialize;
use serde_json::Value;

const NODE_RED_BASE_URL: &str = "https://nodered.edrf.party";

#[derive(Serialize)]
struct TagData {
    id: String,
    kind: String,
}

#[tauri::command]
async fn node_red_request(
    method: String,
    path: String,
    body: Option<Value>,
) -> Result<Value, String> {
    let client = reqwest::Client::new();
    let url = format!("{NODE_RED_BASE_URL}{path}");
    let method = method.to_uppercase();

    let request = match method.as_str() {
        "DELETE" => client.delete(&url),
        "GET" => client.get(&url),
        "POST" => client.post(&url),
        _ => return Err(format!("Metodo HTTP nao suportado: {method}")),
    };

    let request = if let Some(body) = body {
        request.json(&body)
    } else {
        request
    };

    let response = request.send().await.map_err(|error| error.to_string())?;
    let status = response.status();
    let text = response.text().await.map_err(|error| error.to_string())?;
    let value = parse_node_red_response(&text);

    if !status.is_success() {
        return Err(value
            .get("message")
            .or_else(|| value.get("error"))
            .and_then(Value::as_str)
            .map(ToString::to_string)
            .unwrap_or_else(|| format!("HTTP {status}")));
    }

    Ok(value)
}

fn parse_node_red_response(text: &str) -> Value {
    if text.is_empty() {
        Value::Null
    } else {
        serde_json::from_str(text).unwrap_or_else(|_| Value::String(text.to_string()))
    }
}

#[tauri::command]
async fn scan_rfid(app: tauri::AppHandle) -> Result<TagData, String> {
    #[cfg(mobile)]
    {
        use tauri_plugin_nfc::NfcExt;

        let nfc = app.nfc();

        if !nfc.is_available().map_err(|e| e.to_string())? {
            return Err("NFC is not available on this device".to_string());
        }

        let scan_result = nfc
            .scan(tauri_plugin_nfc::ScanRequest {
                kind: tauri_plugin_nfc::ScanKind::Tag {
                    uri: None,
                    mime_type: None,
                },
                keep_session_alive: false,
            })
            .map_err(|e| e.to_string())?;

        Ok(TagData {
            id: format_tag_id(&scan_result.id),
            kind: scan_result.kind.join(", "),
        })
    }
    #[cfg(not(mobile))]
    {
        let _ = app;
        Err(
            "RFID/NFC scanning is currently only supported on mobile devices in this app."
                .to_string(),
        )
    }
}

#[cfg(mobile)]
fn format_tag_id(id: &[u8]) -> String {
    id.iter()
        .map(|byte| format!("{byte:02X}"))
        .collect::<Vec<_>>()
        .join(":")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|_app| {
            #[cfg(mobile)]
            _app.handle().plugin(tauri_plugin_nfc::init())?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![scan_rfid, node_red_request])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
