mod engine;
pub mod http;
pub mod native;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

pub use engine::run_local;

#[derive(Debug, Deserialize)]
pub struct Request {
    pub model: Option<String>,
    pub state: Value,
    pub questions: BTreeMap<String, Question>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
pub enum Question {
    #[serde(rename = "noul")]
    Noul {
        instructions: String,
        criteria: Option<NoulCriteria>,
    },
    #[serde(rename = "choice")]
    Choice {
        instructions: String,
        criteria: BTreeMap<String, Option<String>>,
    },
    #[serde(rename = "score")]
    Score {
        instructions: String,
        criteria: Vec<String>,
    },
}

#[derive(Debug, Deserialize)]
pub struct NoulCriteria {
    #[serde(rename = "true")]
    pub yes: Option<String>,
    #[serde(rename = "false")]
    pub no: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Response {
    pub model: String,
    pub answers: BTreeMap<String, Answer>,
    pub usage: Usage,
    pub latency_ms: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Usage {
    pub input_tokens: u32,
    pub output_tokens: u32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(tag = "type")]
pub enum Answer {
    #[serde(rename = "noul")]
    Noul { noul: f64 },
    #[serde(rename = "choice")]
    Choice {
        choice: String,
        probabilities: BTreeMap<String, f64>,
        confidence: f64,
    },
    #[serde(rename = "score")]
    Score {
        score: f64,
        legend: BTreeMap<String, String>,
        probabilities: BTreeMap<String, f64>,
        confidence: f64,
    },
}

pub fn ask_json(raw: &str) -> Result<String, String> {
    native::eval_json(raw)
}

pub fn ask(req: Request) -> Response {
    let model = req
        .model
        .clone()
        .unwrap_or_else(|| "system-one".to_string());
    run_local(&req, &model)
}
