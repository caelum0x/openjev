use openjev::http;
use std::env;
use std::io::{self, Read};

fn main() {
    let args: Vec<String> = env::args().collect();
    if let Some(i) = args.iter().position(|a| a == "--serve") {
        let addr = args
            .get(i + 1)
            .cloned()
            .unwrap_or_else(|| "127.0.0.1:8091".to_string());
        http::serve(&addr).expect("bind");
        return;
    }

    let mut buf = String::new();
    io::stdin().read_to_string(&mut buf).expect("stdin");
    if buf.trim().is_empty() {
        eprintln!("Usage:\n  echo '{{...request...}}' | openjev\n  openjev --serve 127.0.0.1:8091");
        std::process::exit(2);
    }
    match openjev::ask_json(&buf) {
        Ok(out) => {
            println!("{out}");
        }
        Err(e) => {
            eprintln!("native eval failed ({e}), rust fallback");
            let req: openjev::Request = serde_json::from_str(&buf).expect("invalid JSON request");
            let out = openjev::ask(req);
            serde_json::to_writer_pretty(io::stdout(), &out).unwrap();
            println!();
        }
    }
}
