use crate::{Answer, Question, Request, Response, Usage};
use serde_json::Value;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::time::Instant;

fn tokenize(text: &str) -> Vec<String> {
    let lower = text.to_lowercase().replace('_', " ").replace('/', " ");
    let mut out = Vec::new();
    let mut cur = String::new();
    for c in lower.chars() {
        if c.is_ascii_alphanumeric() {
            cur.push(c);
        } else if !cur.is_empty() {
            push_tok(&mut out, &cur);
            cur.clear();
        }
    }
    if !cur.is_empty() {
        push_tok(&mut out, &cur);
    }
    out
}

fn stem(w: &str) -> String {
    let l = w.len();
    if l <= 3 {
        return w.to_string();
    }
    if w.ends_with("ies") && l > 5 {
        return format!("{}y", &w[..l - 3]);
    }
    if w.ends_with("ing") && l > 5 {
        return w[..l - 3].to_string();
    }
    if w.ends_with("ed") && l > 4 {
        return w[..l - 2].to_string();
    }
    if w.ends_with("ly") && l > 4 {
        return w[..l - 2].to_string();
    }
    if w.ends_with("es") && l > 4 {
        return w[..l - 2].to_string();
    }
    if w.ends_with('s') && !w.ends_with("ss") && l > 3 {
        return w[..l - 1].to_string();
    }
    w.to_string()
}

fn push_tok(out: &mut Vec<String>, w: &str) {
    if w.len() < 2 {
        return;
    }
    if STOP.contains(&w) {
        return;
    }
    out.push(stem(w));
}

const STOP: &[&str] = &[
    "the", "a", "an", "of", "and", "or", "to", "in", "on", "for", "is", "are", "was",
    "were", "be", "been", "this", "that", "it", "as", "at", "by", "with", "from",
    "does", "do", "did", "how", "what", "which", "should", "would", "could", "i",
    "my", "we", "you", "your", "our", "if", "not", "no", "yes", "can", "will",
    "just", "so", "but", "has", "have", "had", "please",
];

fn bag(tokens: &[String]) -> HashMap<String, f64> {
    let orig: HashSet<_> = tokens.iter().cloned().collect();
    let mut tf: HashMap<String, f64> = HashMap::new();
    for t in tokens {
        *tf.entry(t.clone()).or_insert(0.0) += 1.0;
        if let Some(syn) = syn(t) {
            for s in syn {
                if !orig.contains(*s) {
                    *tf.entry((*s).to_string()).or_insert(0.0) += 0.42;
                }
            }
        }
    }
    tf.into_iter()
        .map(|(k, v)| (k, 1.0 + v.ln()))
        .collect()
}

fn syn(t: &str) -> Option<&'static [&'static str]> {
    match t {
        "urgent" | "urgency" | "asap" | "emergency" | "failing" | "help" | "critical" => {
            Some(&["urgent", "urgency", "asap", "emergency", "failing", "help", "days", "hours"])
        }
        "refund" | "charge" | "charged" | "billing" | "payment" | "invoice" => {
            Some(&["refund", "charge", "billing", "payment", "invoice", "duplicate"])
        }
        "bug" | "error" | "crash" | "outage" | "technical" => {
            Some(&["bug", "error", "crash", "outage", "technical", "api"])
        }
        "spam" | "scam" | "prize" | "crypto" => Some(&["spam", "scam", "prize", "crypto", "unsubscribe"]),
        "angry" | "frustrated" | "furious" => Some(&["angry", "frustrated", "furious", "terrible", "twice"]),
        "calm" | "thanks" | "thank" => Some(&["calm", "thanks", "thank", "okay"]),
        "risky" | "destructive" | "delete" | "drop" => {
            Some(&["risky", "destructive", "delete", "drop", "production"])
        }
        _ => None,
    }
}

fn ngrams(text: &str) -> HashMap<String, f64> {
    let s: String = text.to_lowercase().split_whitespace().collect::<Vec<_>>().join(" ");
    let mut tf: HashMap<String, f64> = HashMap::new();
    let b = s.as_bytes();
    if b.len() < 3 {
        if !s.is_empty() {
            tf.insert(s, 1.0);
        }
        return tf;
    }
    for i in 0..=b.len() - 3 {
        let g = &s[i..i + 3];
        if g.trim().is_empty() {
            continue;
        }
        *tf.entry(g.to_string()).or_insert(0.0) += 1.0;
    }
    tf.into_iter()
        .map(|(k, v)| (k, 1.0 + v.ln()))
        .collect()
}

fn cosine(a: &HashMap<String, f64>, b: &HashMap<String, f64>) -> f64 {
    let (small, large) = if a.len() <= b.len() { (a, b) } else { (b, a) };
    let mut dot = 0.0;
    for (k, v) in small {
        if let Some(u) = large.get(k) {
            dot += v * u;
        }
    }
    let d = l2(a) * l2(b);
    if d == 0.0 { 0.0 } else { dot / d }
}

fn l2(v: &HashMap<String, f64>) -> f64 {
    v.values().map(|x| x * x).sum::<f64>().sqrt()
}

fn softmax(logits: &[f64], temp: f64) -> Vec<f64> {
    let t = temp.max(0.12);
    let mx = logits.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
    let exps: Vec<f64> = logits.iter().map(|x| ((x - mx) / t).exp()).collect();
    let s: f64 = exps.iter().sum::<f64>().max(1e-12);
    exps.into_iter().map(|e| e / s).collect()
}

fn peaked(p: &[f64]) -> f64 {
    let n = p.len();
    if n <= 1 {
        return 1.0;
    }
    let h: f64 = p
        .iter()
        .filter(|x| **x > 1e-12)
        .map(|x| -x * x.ln())
        .sum();
    let hmax = (n as f64).ln();
    let peakedness = if hmax == 0.0 { 1.0 } else { 1.0 - h / hmax };
    let mut srt = p.to_vec();
    srt.sort_by(|a, b| b.partial_cmp(a).unwrap());
    let margin = (srt[0] - srt[1]) / (1.0 - 1.0 / n as f64);
    (0.55 * peakedness + 0.45 * margin).clamp(0.0, 1.0)
}

fn r4(x: f64) -> f64 {
    (x * 10000.0).round() / 10000.0
}

fn state_text(state: &Value) -> String {
    match state {
        Value::String(s) => s.clone(),
        other => other.to_string(),
    }
}

struct Doc {
    key: String,
    text: String,
    tokens: Vec<String>,
    bag: HashMap<String, f64>,
    ngrams: HashMap<String, f64>,
}

fn docs(options: &[(String, String)]) -> Vec<Doc> {
    options
        .iter()
        .map(|(key, desc)| {
            let text = format!("{} {} {}", key.replace('_', " "), key, desc);
            let tokens = tokenize(&text);
            let b = bag(&tokens);
            let ng = ngrams(&text);
            Doc {
                key: key.clone(),
                text,
                tokens,
                bag: b,
                ngrams: ng,
            }
        })
        .collect()
}

fn score_options(state: &str, docs: &[Doc]) -> Vec<f64> {
    let st = tokenize(state);
    let sb = bag(&st);
    let sng = ngrams(state);
    let state_set: HashSet<_> = st.iter().cloned().collect();
    let lower = state.to_lowercase();
    let mut df: HashMap<String, i32> = HashMap::new();
    for d in docs {
        let uniq: HashSet<_> = d.tokens.iter().cloned().collect();
        for t in uniq {
            *df.entry(t).or_insert(0) += 1;
        }
    }
    docs.iter()
        .map(|d| {
            let lex = cosine(&sb, &d.bag);
            let fuzzy = cosine(&sng, &d.ngrams);
            let dset: Vec<_> = d
                .tokens
                .iter()
                .filter(|t| df.get(*t).copied().unwrap_or(0) <= 1)
                .cloned()
                .collect::<HashSet<_>>()
                .into_iter()
                .collect::<Vec<_>>();
            let dist_hit = if dset.is_empty() {
                0.0
            } else {
                dset.iter().filter(|t| state_set.contains(*t)).count() as f64
                    / (dset.len() as f64).sqrt()
            };
            let key_hit = if lower.contains(&d.key.replace('_', " ").to_lowercase()) {
                1.0
            } else {
                0.0
            };
            1.15 * lex + 0.7 * fuzzy + 1.7 * dist_hit + 1.1 * key_hit
        })
        .collect()
}

fn temp(raw: &[f64]) -> f64 {
    if raw.len() <= 1 {
        return 0.4;
    }
    let max = raw.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
    let min = raw.iter().cloned().fold(f64::INFINITY, f64::min);
    let spread = max - min;
    if spread < 0.12 {
        0.7
    } else if spread < 0.35 {
        0.48
    } else if spread < 0.8 {
        0.36
    } else {
        0.28
    }
}

fn eval_q(state: &str, q: &Question) -> Answer {
    match q {
        Question::Choice {
            instructions,
            criteria,
        } => {
            let opts: Vec<(String, String)> = criteria
                .iter()
                .map(|(k, v)| (k.clone(), v.clone().unwrap_or_default()))
                .collect();
            let d = docs(&opts);
            let raw = score_options(state, &d);
            let p = softmax(&raw, temp(&raw));
            let mut probabilities = BTreeMap::new();
            for (i, (k, _)) in opts.iter().enumerate() {
                probabilities.insert(k.clone(), r4(p[i]));
            }
            let choice = opts
                .iter()
                .enumerate()
                .max_by(|a, b| p[a.0].partial_cmp(&p[b.0]).unwrap())
                .map(|(_, (k, _))| k.clone())
                .unwrap_or_default();
            Answer::Choice {
                choice,
                probabilities,
                confidence: r4(peaked(&p)),
            }
        }
        Question::Score {
            instructions,
            criteria,
        } => {
            let opts: Vec<(String, String)> = criteria
                .iter()
                .enumerate()
                .map(|(i, c)| (format!("level_{i}"), c.clone()))
                .collect();
            let d = docs(&opts);
            let raw = score_options(state, &d);
            let p = softmax(&raw, temp(&raw));
            let mut probabilities = BTreeMap::new();
            let mut legend = BTreeMap::new();
            let mut expected = 0.0;
            for (i, c) in criteria.iter().enumerate() {
                legend.insert(i.to_string(), c.clone());
                probabilities.insert(i.to_string(), r4(p[i]));
                expected += i as f64 * p[i];
            }
            Answer::Score {
                score: r4(expected),
                legend,
                probabilities,
                confidence: r4(peaked(&p)),
            }
        }
        Question::Noul {
            instructions,
            criteria,
        } => {
            let yes = criteria
                .as_ref()
                .and_then(|c| c.yes.clone())
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| format!("The answer to this question is yes: {instructions}"));
            let no = criteria
                .as_ref()
                .and_then(|c| c.no.clone())
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| format!("The answer to this question is no: {instructions}"));
            let opts = vec![("yes".into(), yes), ("no".into(), no)];
            let d = docs(&opts);
            let raw = score_options(state, &d);
            let p = softmax(&raw, temp(&raw).max(0.42));
            Answer::Noul { noul: r4(p[0].clamp(0.0, 1.0)) }
        }
    }
}

pub fn run_local(req: &Request, model: &str) -> Response {
    let t0 = Instant::now();
    let state = state_text(&req.state);
    let mut answers = BTreeMap::new();
    for (id, q) in &req.questions {
        answers.insert(id.clone(), eval_q(&state, q));
    }
    let ms = t0.elapsed().as_secs_f64() * 1000.0;
    let blob = format!("{}{}", state, req.questions.len());
    let n_answers = answers.len() as u32;
    Response {
        model: model.to_string(),
        answers,
        usage: Usage {
            input_tokens: (blob.split_whitespace().count() as u32).max(1) * 2,
            output_tokens: n_answers * 12,
        },
        latency_ms: (ms * 10.0).round() / 10.0,
    }
}
