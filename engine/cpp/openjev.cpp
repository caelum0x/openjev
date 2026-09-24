#include "openjev.hpp"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <mutex>
#include <sstream>
#include <string>
#include <thread>
#include <unordered_map>
#include <unordered_set>
#include <utility>
#include <vector>

using std::string;
using std::vector;
using Sparse = std::unordered_map<string, double>;

// ---------------------------------------------------------------------------
// Dense kernel (kept for Python ctypes)
// ---------------------------------------------------------------------------

static uint32_t fnv1a(const char *s, int n) {
  uint32_t h = 2166136261u;
  for (int i = 0; i < n; i++) {
    h ^= (unsigned char)s[i];
    h *= 16777619u;
  }
  return h;
}

void openjev_hash_ngrams(const char *text, double *out, int dim) {
  if (!out || dim <= 0) return;
  std::fill(out, out + dim, 0.0);
  if (!text) return;
  int len = (int)std::strlen(text);
  if (len <= 0) return;
  char buf[8];
  int n = 0;
  for (int i = 0; i < len; i++) {
    char c = text[i];
    if (c >= 'A' && c <= 'Z') c = char(c - 'A' + 'a');
    if (c == '\t' || c == '\n' || c == '\r') c = ' ';
    if (n < 7) buf[n++] = c;
    if (n >= 3) {
      uint32_t h = fnv1a(buf + n - 3, 3);
      out[h % dim] += 1.0;
    }
  }
  for (int i = 0; i < dim; i++) {
    if (out[i] > 0) out[i] = 1.0 + std::log(out[i]);
  }
}

double openjev_cosine(const double *a, const double *b, int n) {
  if (!a || !b || n <= 0) return 0.0;
  double dot = 0, na = 0, nb = 0;
  for (int i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  double d = std::sqrt(na) * std::sqrt(nb);
  return d == 0.0 ? 0.0 : dot / d;
}

void openjev_softmax(const double *logits, int n, double temperature, double *out) {
  if (!logits || !out || n <= 0) return;
  double t = temperature < 0.12 ? 0.12 : temperature;
  double mx = logits[0];
  for (int i = 1; i < n; i++) if (logits[i] > mx) mx = logits[i];
  double sum = 0;
  for (int i = 0; i < n; i++) {
    out[i] = std::exp((logits[i] - mx) / t);
    sum += out[i];
  }
  if (sum == 0) sum = 1;
  for (int i = 0; i < n; i++) out[i] /= sum;
}

double openjev_entropy(const double *p, int n) {
  if (!p || n <= 0) return 0;
  double h = 0;
  for (int i = 0; i < n; i++) {
    if (p[i] > 1e-12) h -= p[i] * std::log(p[i]);
  }
  return h;
}

double openjev_confidence(const double *p, int n) {
  if (!p || n <= 1) return 1.0;
  double h = openjev_entropy(p, n);
  double hmax = std::log((double)n);
  double peaked = hmax == 0 ? 1.0 : 1.0 - h / hmax;
  double best = -1, second = -1;
  for (int i = 0; i < n; i++) {
    if (p[i] > best) {
      second = best;
      best = p[i];
    } else if (p[i] > second) {
      second = p[i];
    }
  }
  double margin = (best - std::max(0.0, second)) / (1.0 - 1.0 / n);
  double conf = 0.55 * peaked + 0.45 * margin;
  if (conf < 0) return 0;
  if (conf > 1) return 1;
  return conf;
}

const char *openjev_version(void) { return "openjev-system-one/0.2.0"; }

// ---------------------------------------------------------------------------
// Mini JSON
// ---------------------------------------------------------------------------

struct J {
  enum Type { NUL, BOOL, NUM, STR, ARR, OBJ } type = NUL;
  bool b = false;
  double n = 0;
  string s;
  vector<J> a;
  vector<std::pair<string, J>> o;

  const J *get(const char *k) const {
    if (type != OBJ) return nullptr;
    for (const auto &kv : o) if (kv.first == k) return &kv.second;
    return nullptr;
  }
  string as_str() const {
    if (type == STR) return s;
    if (type == NUM) {
      std::ostringstream os;
      os << n;
      return os.str();
    }
    if (type == BOOL) return b ? "true" : "false";
    return "";
  }
};

struct Parser {
  const char *p;
  const char *end;
  bool ok = true;
  explicit Parser(const char *s) : p(s), end(s + std::strlen(s)) {}
  void skip() {
    while (p < end && (*p == ' ' || *p == '\n' || *p == '\r' || *p == '\t')) p++;
  }
  bool eat(char c) {
    skip();
    if (p < end && *p == c) {
      p++;
      return true;
    }
    return false;
  }
  J parse() {
    skip();
    if (p >= end) {
      ok = false;
      return {};
    }
    char c = *p;
    if (c == 'n') {
      if (end - p >= 4 && std::strncmp(p, "null", 4) == 0) {
        p += 4;
        return {};
      }
      ok = false;
      return {};
    }
    if (c == 't') {
      if (end - p >= 4 && std::strncmp(p, "true", 4) == 0) {
        p += 4;
        J j;
        j.type = J::BOOL;
        j.b = true;
        return j;
      }
      ok = false;
      return {};
    }
    if (c == 'f') {
      if (end - p >= 5 && std::strncmp(p, "false", 5) == 0) {
        p += 5;
        J j;
        j.type = J::BOOL;
        j.b = false;
        return j;
      }
      ok = false;
      return {};
    }
    if (c == '"') return parse_str();
    if (c == '[') return parse_arr();
    if (c == '{') return parse_obj();
    if (c == '-' || (c >= '0' && c <= '9')) return parse_num();
    ok = false;
    return {};
  }
  J parse_str() {
    p++;
    string s;
    while (p < end && *p != '"') {
      if (*p == '\\' && p + 1 < end) {
        p++;
        char e = *p++;
        switch (e) {
          case 'n': s += '\n'; break;
          case 't': s += '\t'; break;
          case 'r': s += '\r'; break;
          case '"': s += '"'; break;
          case '\\': s += '\\'; break;
          case '/': s += '/'; break;
          case 'u': {
            if (p + 4 > end) {
              ok = false;
              return {};
            }
            unsigned cp = 0;
            for (int i = 0; i < 4; i++) {
              char h = *p++;
              cp <<= 4;
              if (h >= '0' && h <= '9') cp += h - '0';
              else if (h >= 'a' && h <= 'f') cp += h - 'a' + 10;
              else if (h >= 'A' && h <= 'F') cp += h - 'A' + 10;
            }
            if (cp < 128) s += char(cp);
            else s += '?';
            break;
          }
          default: s += e; break;
        }
      } else {
        s += *p++;
      }
    }
    if (p >= end || *p != '"') {
      ok = false;
      return {};
    }
    p++;
    J j;
    j.type = J::STR;
    j.s = std::move(s);
    return j;
  }
  J parse_num() {
    char *ep = nullptr;
    double v = std::strtod(p, &ep);
    if (ep == p) {
      ok = false;
      return {};
    }
    p = ep;
    J j;
    j.type = J::NUM;
    j.n = v;
    return j;
  }
  J parse_arr() {
    p++;
    J j;
    j.type = J::ARR;
    skip();
    if (eat(']')) return j;
    while (ok) {
      j.a.push_back(parse());
      skip();
      if (eat(']')) break;
      if (!eat(',')) {
        ok = false;
        break;
      }
    }
    return j;
  }
  J parse_obj() {
    p++;
    J j;
    j.type = J::OBJ;
    skip();
    if (eat('}')) return j;
    while (ok) {
      skip();
      J k = parse_str();
      if (!ok) break;
      if (!eat(':')) {
        ok = false;
        break;
      }
      J v = parse();
      j.o.emplace_back(std::move(k.s), std::move(v));
      skip();
      if (eat('}')) break;
      if (!eat(',')) {
        ok = false;
        break;
      }
    }
    return j;
  }
};

static string json_escape(const string &s) {
  string o;
  o.reserve(s.size() + 8);
  for (unsigned char c : s) {
    switch (c) {
      case '"': o += "\\\""; break;
      case '\\': o += "\\\\"; break;
      case '\n': o += "\\n"; break;
      case '\r': o += "\\r"; break;
      case '\t': o += "\\t"; break;
      default:
        if (c < 0x20) {
          char buf[8];
          std::snprintf(buf, sizeof(buf), "\\u%04x", c);
          o += buf;
        } else {
          o += char(c);
        }
    }
  }
  return o;
}

static string json_str(const string &s) { return "\"" + json_escape(s) + "\""; }

static double round4(double x) { return std::round(x * 10000.0) / 10000.0; }
static double clamp01(double x) {
  if (!std::isfinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

// ---------------------------------------------------------------------------
// Tokenize
// ---------------------------------------------------------------------------

static const std::unordered_set<string> STOP = {
    "the", "a", "an", "of", "and", "or", "to", "in", "on", "for", "is", "are",
    "was", "were", "be", "been", "this", "that", "it", "as", "at", "by", "with",
    "from", "does", "do", "did", "how", "what", "which", "should", "would",
    "could", "i", "my", "we", "you", "your", "our", "me", "them", "they",
    "their", "its", "if", "yes", "can", "will", "just", "so", "but", "about",
    "into", "over", "after", "before", "than", "then", "too", "very", "also",
    "here", "there", "when", "where", "who", "whom", "has", "have", "had",
    "please"};

static string stem(string w) {
  auto ends = [&](const char *suf) {
    size_t n = std::strlen(suf);
    return w.size() >= n && w.compare(w.size() - n, n, suf) == 0;
  };
  if (w.size() <= 3) return w;
  if (ends("ies") && w.size() > 5) return w.substr(0, w.size() - 3) + "y";
  if (ends("ing") && w.size() > 5) {
    w = w.substr(0, w.size() - 3);
    if (w.size() > 3 && w.back() == w[w.size() - 2] && w.back() != 's')
      w.pop_back();
    return w;
  }
  if (ends("ed") && w.size() > 4) return w.substr(0, w.size() - 2);
  if (ends("ly") && w.size() > 4) return w.substr(0, w.size() - 2);
  if (ends("es") && w.size() > 4) return w.substr(0, w.size() - 2);
  if (ends("s") && !ends("ss") && w.size() > 3) return w.substr(0, w.size() - 1);
  return w;
}

static vector<string> tokenize(const string &text) {
  string lower;
  lower.reserve(text.size());
  for (unsigned char c : text) {
    if (c == '_' || c == '/' || c == '\\') lower += ' ';
    else if (c >= 'A' && c <= 'Z') lower += char(c - 'A' + 'a');
    else lower += char(c);
  }
  vector<string> out;
  string cur;
  for (char c : lower) {
    if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')) cur += c;
    else if (!cur.empty()) {
      if (cur.size() >= 2 && !STOP.count(cur)) out.push_back(stem(cur));
      cur.clear();
    }
  }
  if (cur.size() >= 2 && !STOP.count(cur)) out.push_back(stem(cur));
  return out;
}

static const vector<vector<string>> SYNSETS = {
    {"urgent", "urgency", "immediately", "asap", "emergency", "now", "failing", "failed", "down", "outage", "wait", "waiting", "hours", "days", "critical", "help", "tonight", "deadline", "overdue", "stuck", "blocked", "timesensitive"},
    {"refund", "refunds", "refunded", "charge", "charged", "charges", "payment", "payments", "invoice", "billing", "billed", "price", "cost", "subscription", "duplicate", "overcharged", "money", "payout", "payouts"},
    {"bug", "bugs", "error", "errors", "crash", "crashed", "crashing", "exception", "integration", "api", "outage", "timeout", "broken", "fails", "failing", "failure", "500", "404", "technical"},
    {"spam", "scam", "phishing", "unsubscribe", "lottery", "prize", "winner", "crypto", "cheap", "offer"},
    {"sales", "pricing", "upgrade", "upgrades", "plan", "plans", "demo", "trial", "quote", "enterprise"},
    {"account", "login", "password", "access", "locked", "signup", "signin", "credentials", "username"},
    {"shipping", "shipment", "delivery", "tracking", "delayed", "package", "lost", "transit"},
    {"return", "returns", "returned", "exchange", "exchanges", "sendback"},
    {"angry", "furious", "frustrated", "frustration", "ridiculous", "unacceptable", "terrible", "worst", "hate", "third", "twice", "again", "still", "outraged"},
    {"calm", "thanks", "thank", "okay", "ok", "received", "update", "appreciate", "neutral", "civil"},
    {"risky", "destructive", "irreversible", "delete", "drop", "production", "migrate", "schema", "danger"},
    {"human", "escalate", "manager", "legal", "compliance", "pii", "policy", "review"},
    {"workaround", "chrome", "safari", "browser", "alternate", "csv"},
    {"pixel", "pixels", "misaligned", "typo", "cosmetic", "label", "icon"},
    {"blocking", "blocker", "cannot", "nobody", "everyone", "outage", "down", "500", "crash", "login", "signin"},
    {"cancelled", "canceled", "cancellation", "flight", "flights"},
    {"sent", "shipped", "already", "status", "progress", "arrived"},
    {"money", "paid", "payout", "refund", "refunds", "reimburse"},
    {"times", "again", "repeat", "repeated", "third", "twice", "before", "already"},
    {"duplicate", "twice", "double", "two", "charged"},
    {"person", "human", "agent", "representative", "someone", "operator", "staff", "manager", "supervisor"},
    {"swap", "exchange", "exchanges", "size", "fit", "wrong", "replace", "replacement"},
    {"gdpr", "privacy", "consent", "personal", "controller", "processor", "erasure", "forgotten"},
    {"lights", "light", "lamp", "thermostat", "kitchen", "bedroom", "lock", "dim", "speaker"},
};

static std::unordered_map<string, vector<string>> SYN_INDEX;
static std::once_flag SYN_ONCE;

static void build_syn() {
  for (const auto &set : SYNSETS) {
    vector<string> all = set;
    for (const auto &w : set) all.push_back(stem(w));
    std::sort(all.begin(), all.end());
    all.erase(std::unique(all.begin(), all.end()), all.end());
    for (const auto &w : all) {
      auto &dst = SYN_INDEX[w];
      for (const auto &x : all) {
        if (std::find(dst.begin(), dst.end(), x) == dst.end()) dst.push_back(x);
      }
    }
  }
}

static vector<string> expand_tokens(const vector<string> &tokens) {
  std::call_once(SYN_ONCE, build_syn);
  vector<string> out;
  std::unordered_set<string> seen;
  for (const auto &t : tokens) {
    if (seen.insert(t).second) out.push_back(t);
    auto it = SYN_INDEX.find(t);
    if (it == SYN_INDEX.end()) continue;
    for (const auto &s : it->second) {
      if (seen.insert(s).second) out.push_back(s);
    }
  }
  return out;
}

static Sparse bag(const vector<string> &tokens, double expanded_w = 0.42) {
  std::unordered_set<string> original(tokens.begin(), tokens.end());
  Sparse tf;
  for (const auto &t : expand_tokens(tokens)) {
    tf[t] += original.count(t) ? 1.0 : expanded_w;
  }
  Sparse out;
  for (auto &kv : tf) out[kv.first] = 1.0 + std::log(kv.second);
  return out;
}

static Sparse char_ngrams(const string &text, int n = 3) {
  string s;
  bool sp = false;
  for (unsigned char c : text) {
    char lc = (c >= 'A' && c <= 'Z') ? char(c - 'A' + 'a') : char(c);
    if (lc == '\n' || lc == '\t' || lc == '\r') lc = ' ';
    if (lc == ' ') {
      if (!sp && !s.empty()) {
        s += ' ';
        sp = true;
      }
    } else {
      s += lc;
      sp = false;
    }
  }
  while (!s.empty() && s.back() == ' ') s.pop_back();
  Sparse tf;
  if ((int)s.size() < n) {
    if (!s.empty()) tf[s] = 1;
    Sparse out;
    for (auto &kv : tf) out[kv.first] = 1.0 + std::log(kv.second);
    return out;
  }
  for (size_t i = 0; i + n <= s.size(); i++) {
    string g = s.substr(i, n);
    bool empty = true;
    for (char c : g) if (c != ' ') empty = false;
    if (empty) continue;
    tf[g] += 1;
  }
  Sparse out;
  for (auto &kv : tf) out[kv.first] = 1.0 + std::log(kv.second);
  return out;
}

static double l2(const Sparse &v) {
  double s = 0;
  for (auto &kv : v) s += kv.second * kv.second;
  return std::sqrt(s);
}

static double cosine(const Sparse &a, const Sparse &b) {
  const Sparse *small = &a, *large = &b;
  if (a.size() > b.size()) {
    small = &b;
    large = &a;
  }
  double dot = 0;
  for (auto &kv : *small) {
    auto it = large->find(kv.first);
    if (it != large->end()) dot += kv.second * it->second;
  }
  double d = l2(a) * l2(b);
  return d == 0 ? 0 : dot / d;
}

static Sparse apply_idf(const Sparse &v, const std::unordered_map<string, double> &idf) {
  Sparse o;
  for (auto &kv : v) {
    auto it = idf.find(kv.first);
    o[kv.first] = kv.second * (it == idf.end() ? 1.0 : it->second);
  }
  return o;
}

static std::unordered_map<string, double> idf_weight(const vector<Sparse> &docs) {
  std::unordered_map<string, int> df;
  for (const auto &d : docs) {
    for (auto &kv : d) df[kv.first] += 1;
  }
  int n = std::max(1, (int)docs.size());
  std::unordered_map<string, double> idf;
  for (auto &kv : df) idf[kv.first] = std::log((n + 1.0) / (kv.second + 0.5)) + 0.2;
  return idf;
}

static vector<std::unordered_set<string>> distinctive(const vector<vector<string>> &opts) {
  std::unordered_map<string, int> df;
  for (const auto &toks : opts) {
    std::unordered_set<string> u(toks.begin(), toks.end());
    for (const auto &t : u) df[t] += 1;
  }
  vector<std::unordered_set<string>> out;
  for (const auto &toks : opts) {
    std::unordered_set<string> s;
    for (const auto &t : toks) if (df[t] <= 1) s.insert(t);
    out.push_back(std::move(s));
  }
  return out;
}

static double bigram_overlap(const vector<string> &a, const vector<string> &b) {
  if (a.size() < 2 || b.size() < 2) return 0;
  std::unordered_set<string> bs;
  for (size_t i = 0; i + 1 < b.size(); i++) bs.insert(a[0].empty() ? b[i] + "_" + b[i + 1] : b[i] + "_" + b[i + 1]);
  bs.clear();
  for (size_t i = 0; i + 1 < b.size(); i++) bs.insert(b[i] + "_" + b[i + 1]);
  std::unordered_set<string> as;
  for (size_t i = 0; i + 1 < a.size(); i++) as.insert(a[i] + "_" + a[i + 1]);
  if (as.empty() || bs.empty()) return 0;
  int hit = 0;
  for (const auto &g : as) if (bs.count(g)) hit++;
  return hit / std::sqrt((double)as.size() * (double)bs.size());
}

static bool contains_phrase(const string &hay, const string &needle) {
  if (needle.empty()) return false;
  string h = hay, n = needle;
  for (char &c : h) if (c >= 'A' && c <= 'Z') c = char(c - 'A' + 'a');
  for (char &c : n) if (c >= 'A' && c <= 'Z') c = char(c - 'A' + 'a');
  return h.find(n) != string::npos;
}

static double peaked(const vector<double> &p, double blend = 0.55) {
  int n = (int)p.size();
  if (n <= 1) return 1;
  double h = 0;
  for (double x : p) if (x > 1e-12) h -= x * std::log(x);
  double hmax = std::log((double)n);
  double peakedness = hmax == 0 ? 1 : 1 - h / hmax;
  vector<double> s = p;
  std::sort(s.begin(), s.end(), std::greater<double>());
  double margin = (s[0] - (n > 1 ? s[1] : 0)) / (1.0 - 1.0 / n);
  return clamp01(blend * peakedness + (1 - blend) * margin);
}

static double adaptive_temp(const vector<double> &raw, double scale) {
  if (raw.size() <= 1) return 0.4 * scale;
  double mx = *std::max_element(raw.begin(), raw.end());
  double mn = *std::min_element(raw.begin(), raw.end());
  double spread = mx - mn;
  double t = 0.28;
  if (spread < 0.12) t = 0.7;
  else if (spread < 0.35) t = 0.48;
  else if (spread < 0.8) t = 0.36;
  return t * scale;
}

static vector<double> as_probs(const vector<double> &raw, double scale) {
  double t = adaptive_temp(raw, scale);
  int n = (int)raw.size();
  vector<double> out(n);
  if (n == 0) return out;
  openjev_softmax(raw.data(), n, t, out.data());
  double sum = 0;
  for (double x : out) sum += x;
  if (sum <= 0) sum = 1;
  for (double &x : out) x = round4(x / sum);
  return out;
}

static void renormalize(vector<double> &p) {
  double sum = 0;
  for (double x : p) sum += x;
  if (sum <= 0) {
    double u = round4(1.0 / std::max(1, (int)p.size()));
    for (double &x : p) x = u;
    return;
  }
  int maxi = 0;
  double s2 = 0;
  for (int i = 0; i < (int)p.size(); i++) {
    p[i] = round4(p[i] / sum);
    s2 += p[i];
    if (p[i] >= p[maxi]) maxi = i;
  }
  p[maxi] = round4(p[maxi] + round4(1 - s2));
}

// ---------------------------------------------------------------------------
// Flatten / state
// ---------------------------------------------------------------------------

struct Flat {
  string positive, negative, question;
  vector<string> examples, paths;
};

static const std::unordered_set<string> NEG_KEYS = {"not_for", "not", "avoid", "except", "exclude"};
static const std::unordered_set<string> PATH_KEYS = {"inspect", "compare", "field", "path"};

static void extract_ticks(const string &text, vector<string> &paths) {
  for (size_t i = 0; i < text.size(); i++) {
    if (text[i] != '`') continue;
    size_t j = text.find('`', i + 1);
    if (j == string::npos) break;
    string p = text.substr(i + 1, j - i - 1);
    while (!p.empty() && p.front() == ' ') p.erase(p.begin());
    while (!p.empty() && p.back() == ' ') p.pop_back();
    if (!p.empty()) paths.push_back(p);
    i = j;
  }
}

static void walk(const J &v, Flat &f, const string &keyHint);

static void walk(const J &v, Flat &f, const string &keyHint) {
  if (v.type == J::NUL) return;
  if (v.type == J::STR) {
    if (NEG_KEYS.count(keyHint)) f.negative += (f.negative.empty() ? "" : " \n ") + v.s;
    else f.positive += (f.positive.empty() ? "" : " \n ") + v.s;
    if (keyHint == "question" && f.question.empty()) f.question = v.s;
    if (keyHint == "examples") f.examples.push_back(v.s);
    extract_ticks(v.s, f.paths);
    return;
  }
  if (v.type == J::NUM || v.type == J::BOOL) {
    f.positive += (f.positive.empty() ? "" : " \n ") + v.as_str();
    return;
  }
  if (v.type == J::ARR) {
    if (keyHint == "examples" || keyHint == "signals") {
      for (const auto &x : v.a) {
        if (x.type == J::STR) f.examples.push_back(x.s);
        else walk(x, f, keyHint);
      }
      return;
    }
    for (const auto &x : v.a) walk(x, f, keyHint);
    return;
  }
  if (v.type == J::OBJ) {
    for (const auto &kv : v.o) {
      if (kv.first == "name" && kv.second.type == J::STR) {
        f.paths.push_back(kv.second.s);
        string lab = kv.second.s;
        for (char &c : lab) if (c == '_') c = ' ';
        f.positive += (f.positive.empty() ? "" : " \n ") + lab;
        continue;
      }
      if (PATH_KEYS.count(kv.first) && kv.second.type == J::STR) {
        string p = kv.second.s;
        p.erase(std::remove(p.begin(), p.end(), '`'), p.end());
        f.paths.push_back(p);
      }
      walk(kv.second, f, kv.first);
    }
  }
}

static Flat flatten(const J *v) {
  Flat f;
  if (!v) return f;
  if (v->type == J::STR) {
    f.positive = v->s;
    f.question = v->s;
    extract_ticks(v->s, f.paths);
    return f;
  }
  walk(*v, f, "");
  if (f.question.empty()) f.question = f.positive;
  extract_ticks(f.positive, f.paths);
  return f;
}

static string state_prose(const J &v, int depth = 0) {
  if (v.type == J::NUL) return "";
  if (v.type == J::STR) return v.s;
  if (v.type == J::NUM || v.type == J::BOOL) return v.as_str();
  if (v.type == J::ARR) {
    string s;
    for (size_t i = 0; i < v.a.size(); i++) {
      string inner = state_prose(v.a[i], depth + 1);
      if (inner.empty()) continue;
      if (!s.empty()) s += depth == 0 ? "\n" : ", ";
      s += inner;
    }
    return s;
  }
  if (v.type == J::OBJ) {
    string s;
    for (const auto &kv : v.o) {
      string lab = kv.first;
      for (char &c : lab) if (c == '_') c = ' ';
      string inner = state_prose(kv.second, depth + 1);
      if (inner.empty()) continue;
      if (!s.empty()) s += depth == 0 ? "\n" : "; ";
      s += lab + ": " + inner;
    }
    return s;
  }
  return "";
}

static const J *get_path(const J &root, const string &path) {
  string clean;
  for (char c : path) if (c != '`') clean += c;
  vector<string> parts;
  string cur;
  for (size_t i = 0; i < clean.size(); i++) {
    if (clean[i] == '.') {
      if (!cur.empty()) {
        parts.push_back(cur);
        cur.clear();
      }
    } else if (clean[i] == '[') {
      if (!cur.empty()) {
        parts.push_back(cur);
        cur.clear();
      }
      size_t j = clean.find(']', i);
      if (j == string::npos) return nullptr;
      parts.push_back(clean.substr(i + 1, j - i - 1));
      i = j;
    } else {
      cur += clean[i];
    }
  }
  if (!cur.empty()) parts.push_back(cur);
  const J *curj = &root;
  for (const auto &p : parts) {
    if (!curj) return nullptr;
    if (curj->type == J::ARR) {
      int idx = std::atoi(p.c_str());
      if (idx < 0 || idx >= (int)curj->a.size()) return nullptr;
      curj = &curj->a[idx];
    } else if (curj->type == J::OBJ) {
      curj = curj->get(p.c_str());
    } else {
      return nullptr;
    }
  }
  return curj;
}

static string focused_state(const J &state, const vector<string> &paths) {
  string full = state_prose(state);
  if (paths.empty()) return full;
  string slices;
  std::unordered_set<string> seen;
  for (auto p : paths) {
    p.erase(std::remove(p.begin(), p.end(), '`'), p.end());
    if (p.empty() || !seen.insert(p).second) continue;
    const J *v = get_path(state, p);
    if (!v) continue;
    string lab = p;
    for (char &c : lab) if (c == '.' || c == '_') c = ' ';
    if (!slices.empty()) slices += "\n";
    slices += lab + ": " + state_prose(*v);
  }
  if (slices.empty()) return full;
  return slices + "\n\n" + full;
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

struct Weights {
  double lex = 1.15, fuzzy = 0.72, dist = 1.95, keyHit = 1.4, descHit = 1.05;
  double syn = 1.5, ex = 1.7, bigram = 1.25, neg = 1.55;
  double tempScale = 1, noulTempFloor = 0.4, peakedBlend = 0.55;
};

static Weights weights_for(const string &model) {
  Weights w;
  if (model == "openjev-v13") {
    w.tempScale = 0.94;
    w.peakedBlend = 0.58;
    w.dist = 1.85;
  } else if (model == "rlhf") {
    w.tempScale = 0.72;
    w.dist = 1.7;
    w.peakedBlend = 0.68;
    w.noulTempFloor = 0.34;
  } else if (model == "rlcd") {
    w.lex = 0.9;
    w.fuzzy = 0.55;
    w.dist = 2.5;
    w.syn = 1.1;
    w.tempScale = 0.88;
    w.peakedBlend = 0.6;
    w.neg = 1.8;
  }
  return w;
}

static string canonical_model(string m) {
  for (char &c : m) if (c >= 'A' && c <= 'Z') c = char(c - 'A' + 'a');
  if (m.empty() || m == "openjev-latest" || m == "openjev-fast" || m == "openjev" ||
      m == "systemone" || m == "system_one")
    return "system-one";
  if (m == "openjev-1.12") return "openjev-v13";
  return m;
}

struct OptDoc {
  string key, text, negative;
  vector<string> tokens, examples, neg_tokens;
  Sparse bagv, ngrams;
};

static double negation_clash(const string &state_lower, const string &doc) {
  string d = doc;
  for (char &c : d) if (c >= 'A' && c <= 'Z') c = char(c - 'A' + 'a');
  double clash = 0;
  const char *negs[] = {"no ", "not ", "never ", "without "};
  for (const char *neg : negs) {
    size_t pos = 0;
    while ((pos = d.find(neg, pos)) != string::npos) {
      size_t start = pos + std::strlen(neg);
      size_t end = start;
      while (end < d.size() && d[end] >= 'a' && d[end] <= 'z') end++;
      string phrase = d.substr(start, end - start);
      pos = start;
      if (phrase.size() < 3) continue;
      if (phrase == "the" || phrase == "this" || phrase == "that" || phrase == "hold" ||
          phrase == "evidence")
        continue;
      bool stated = state_lower.find(phrase) != string::npos;
      bool stated_neg = state_lower.find(string(neg) + phrase) != string::npos;
      if (stated && !stated_neg) clash += 1.2;
    }
  }
  return clash;
}

static OptDoc make_doc(const string &key, const J *desc) {
  Flat fl = flatten(desc);
  string key_text = key;
  for (char &c : key_text) if (c == '_') c = ' ';
  OptDoc d;
  d.key = key;
  d.negative = fl.negative;
  d.examples = fl.examples;
  d.text = key_text + " \n " + key + " \n " + fl.positive;
  d.tokens = tokenize(d.text);
  d.bagv = bag(d.tokens);
  d.ngrams = char_ngrams(d.text);
  d.neg_tokens = tokenize(d.negative);
  return d;
}

struct Feat {
  double lex = 0, fuzzy = 0, dist = 0, keyHit = 0, descHit = 0, syn = 0, bigram = 0,
         ex = 0, neg = 0;
};

static vector<Feat> score_options(const string &state_text, const vector<OptDoc> &docs) {
  auto state_tokens = tokenize(state_text);
  auto state_bag = bag(state_tokens);
  auto state_ng = char_ngrams(state_text);
  vector<Sparse> bags = {state_bag};
  for (const auto &d : docs) bags.push_back(d.bagv);
  auto idf = idf_weight(bags);
  auto state_w = apply_idf(state_bag, idf);
  vector<vector<string>> toksets;
  for (const auto &d : docs) toksets.push_back(d.tokens);
  auto dist = distinctive(toksets);
  std::unordered_set<string> state_set(state_tokens.begin(), state_tokens.end());
  string lower = state_text;
  for (char &c : lower) if (c >= 'A' && c <= 'Z') c = char(c - 'A' + 'a');

  vector<Feat> out;
  for (size_t i = 0; i < docs.size(); i++) {
    const auto &d = docs[i];
    auto dw = apply_idf(d.bagv, idf);
    Feat f;
    f.lex = cosine(state_w, dw);
    f.fuzzy = cosine(state_ng, d.ngrams);
    const auto &dset = dist[i];
    if (!dset.empty()) {
      double n = 0;
      for (const auto &t : dset) {
        if (!state_set.count(t)) continue;
        int idx = -1;
        for (int k = 0; k < (int)state_tokens.size(); k++)
          if (state_tokens[k] == t) {
            idx = k;
            break;
          }
        double pos = idx < 0 ? 1 : double(idx) / std::max(1, (int)state_tokens.size());
        n += 1.15 - 0.35 * pos;
      }
      f.dist = n / std::sqrt((double)dset.size());
    }
    string keysp = d.key;
    for (char &c : keysp) if (c == '_') c = ' ';
    f.keyHit = contains_phrase(lower, keysp) ? 1 : 0;
    for (const auto &t : d.tokens) {
      if (state_set.count(t) && dset.count(t)) f.descHit += 0.2;
    }
    auto opt_exp = expand_tokens(d.tokens);
    std::unordered_set<string> opt_set(opt_exp.begin(), opt_exp.end());
    double syn_hit = 0;
    for (const auto &t : state_tokens) if (opt_set.count(t)) syn_hit += 1;
    f.syn = state_tokens.empty() ? 0 : syn_hit / std::sqrt((double)state_tokens.size());
    f.bigram = bigram_overlap(state_tokens, d.tokens);
    for (const auto &ex : d.examples) {
      auto et = tokenize(ex);
      auto eb = bag(et);
      auto en = char_ngrams(ex);
      double s = 0.65 * cosine(state_bag, eb) + 0.35 * cosine(state_ng, en);
      f.ex = std::max(f.ex, s);
      f.ex = std::max(f.ex, bigram_overlap(state_tokens, et));
    }
    if (!d.negative.empty()) {
      auto nb = bag(d.neg_tokens);
      auto nn = char_ngrams(d.negative);
      f.neg = 0.7 * cosine(state_bag, nb) + 0.3 * cosine(state_ng, nn);
      int nHit = 0;
      for (const auto &t : d.neg_tokens) if (state_set.count(t)) nHit++;
      if (!d.neg_tokens.empty()) f.neg += nHit / std::sqrt((double)d.neg_tokens.size());
    }
    f.neg += negation_clash(lower, d.text);
    out.push_back(f);
  }
  return out;
}

static double combine(const Feat &f, const Weights &w) {
  return w.lex * f.lex + w.fuzzy * f.fuzzy + w.dist * f.dist + w.keyHit * f.keyHit +
         w.descHit * f.descHit + w.syn * f.syn + w.bigram * f.bigram + w.ex * f.ex -
         w.neg * f.neg;
}

struct AnswerJson {
  string type;
  string body;
};

static string q_state(const J &state, const J &q) {
  Flat inst = flatten(q.get("instructions"));
  vector<string> extra = inst.paths;
  const J *crit = q.get("criteria");
  if (crit && crit->type == J::OBJ) {
    const J *t = crit->get("true");
    const J *f = crit->get("false");
    if (t) {
      auto ft = flatten(t);
      extra.insert(extra.end(), ft.paths.begin(), ft.paths.end());
    }
    if (f) {
      auto ff = flatten(f);
      extra.insert(extra.end(), ff.paths.begin(), ff.paths.end());
    }
  }
  return focused_state(state, extra);
}

static AnswerJson eval_choice(const string &state_text, const J &q, const Weights &w) {
  const J *crit = q.get("criteria");
  AnswerJson a;
  a.type = "choice";
  if (!crit || crit->type != J::OBJ || crit->o.empty()) {
    a.body = "{\"type\":\"choice\",\"choice\":\"\",\"probabilities\":{},\"confidence\":0}";
    return a;
  }
  vector<string> keys;
  vector<OptDoc> docs;
  for (const auto &kv : crit->o) {
    keys.push_back(kv.first);
    docs.push_back(make_doc(kv.first, &kv.second));
  }
  auto feats = score_options(state_text, docs);
  vector<double> raw(feats.size());
  for (size_t i = 0; i < feats.size(); i++) raw[i] = combine(feats[i], w);
  auto p = as_probs(raw, w.tempScale);
  renormalize(p);
  int best = 0;
  for (int i = 1; i < (int)p.size(); i++) if (p[i] > p[best]) best = i;
  std::ostringstream os;
  os << "{\"type\":\"choice\",\"choice\":" << json_str(keys[best]) << ",\"probabilities\":{";
  for (size_t i = 0; i < keys.size(); i++) {
    if (i) os << ",";
    os << json_str(keys[i]) << ":" << p[i];
  }
  os << "},\"confidence\":" << round4(peaked(p, w.peakedBlend)) << "}";
  a.body = os.str();
  return a;
}

static vector<double> smooth_ordered(vector<double> p) {
  if (p.size() <= 2) return p;
  vector<double> out(p.size());
  for (size_t i = 0; i < p.size(); i++) {
    double l = i ? p[i - 1] : 0;
    double r = i + 1 < p.size() ? p[i + 1] : 0;
    out[i] = 0.78 * p[i] + 0.11 * l + 0.11 * r;
  }
  double s = 0;
  for (double x : out) s += x;
  if (s <= 0) s = 1;
  for (double &x : out) x /= s;
  return out;
}

static AnswerJson eval_score(const string &state_text, const J &q, const Weights &w) {
  const J *crit = q.get("criteria");
  AnswerJson a;
  a.type = "score";
  if (!crit || crit->type != J::ARR || crit->a.size() < 2) {
    a.body =
        "{\"type\":\"score\",\"score\":0,\"legend\":{},\"probabilities\":{},\"confidence\":0}";
    return a;
  }
  vector<OptDoc> docs;
  for (size_t i = 0; i < crit->a.size(); i++) {
    docs.push_back(make_doc("level_" + std::to_string(i), &crit->a[i]));
  }
  auto feats = score_options(state_text, docs);
  vector<double> raw(feats.size());
  for (size_t i = 0; i < feats.size(); i++) raw[i] = combine(feats[i], w);
  auto p0 = as_probs(raw, w.tempScale);
  auto p = smooth_ordered(p0);
  renormalize(p);
  double expected = 0;
  std::ostringstream os;
  os << "{\"type\":\"score\",\"legend\":{";
  for (size_t i = 0; i < crit->a.size(); i++) {
    if (i) os << ",";
    string lab = flatten(&crit->a[i]).positive;
    os << json_str(std::to_string(i)) << ":" << json_str(lab);
  }
  os << "},\"probabilities\":{";
  for (size_t i = 0; i < p.size(); i++) {
    if (i) os << ",";
    os << json_str(std::to_string(i)) << ":" << p[i];
    expected += i * p[i];
  }
  os << "},\"score\":" << round4(expected) << ",\"confidence\":"
     << round4(peaked(p, w.peakedBlend)) << "}";
  a.body = os.str();
  return a;
}

static AnswerJson eval_noul(const string &state_text, const J &q, const Weights &w) {
  Flat inst = flatten(q.get("instructions"));
  const J *crit = q.get("criteria");
  const J *yesj = crit ? crit->get("true") : nullptr;
  const J *noj = crit ? crit->get("false") : nullptr;
  Flat yesf = flatten(yesj);
  Flat nof = flatten(noj);
  J yes_desc;
  yes_desc.type = J::OBJ;
  string what = inst.question.empty() ? inst.positive : inst.question;
  if (!yesf.positive.empty()) what += " " + yesf.positive;
  J whatj;
  whatj.type = J::STR;
  whatj.s = what;
  yes_desc.o.push_back({"what", whatj});
  if (!yesf.examples.empty()) {
    J ex;
    ex.type = J::ARR;
    for (const auto &e : yesf.examples) {
      J s;
      s.type = J::STR;
      s.s = e;
      ex.a.push_back(s);
    }
    yes_desc.o.push_back({"examples", ex});
  }
  J nf;
  nf.type = J::STR;
  nf.s = yesf.negative.empty() ? nof.positive : yesf.negative;
  yes_desc.o.push_back({"not_for", nf});

  J no_desc;
  no_desc.type = J::OBJ;
  J nwhat;
  nwhat.type = J::STR;
  nwhat.s = nof.positive.empty()
                ? "the condition does not hold; no evidence in the state; the opposite is true"
                : nof.positive;
  no_desc.o.push_back({"what", nwhat});
  if (!nof.examples.empty()) {
    J ex;
    ex.type = J::ARR;
    for (const auto &e : nof.examples) {
      J s;
      s.type = J::STR;
      s.s = e;
      ex.a.push_back(s);
    }
    no_desc.o.push_back({"examples", ex});
  }
  if (!nof.negative.empty()) {
    J nn;
    nn.type = J::STR;
    nn.s = nof.negative;
    no_desc.o.push_back({"not_for", nn});
  }

  vector<OptDoc> docs = {make_doc("yes", &yes_desc), make_doc("no", &no_desc)};
  auto feats = score_options(state_text, docs);
  Feat z;
  double yes_raw = combine(feats.empty() ? z : feats[0], w);
  Weights noW = w;
  noW.syn *= 0.7;
  noW.dist *= 0.6;
  double no_raw = combine(feats.size() < 2 ? z : feats[1], noW);
  vector<double> raw = {yes_raw, no_raw};
  double t = std::max(w.noulTempFloor, adaptive_temp(raw, w.tempScale));
  vector<double> p(2);
  openjev_softmax(raw.data(), 2, t, p.data());
  double yes = p[0];
  string lower = state_text;
  for (char &c : lower) if (c >= 'A' && c <= 'Z') c = char(c - 'A' + 'a');
  if (lower.find("not") != string::npos || lower.find("never") != string::npos ||
      lower.find(" no ") != string::npos || lower.find("isn't") != string::npos ||
      lower.find("don't") != string::npos || lower.find("cannot") != string::npos) {
    auto inst_toks = tokenize(inst.question.empty() ? inst.positive : inst.question);
    auto state_toks = tokenize(state_text);
    std::unordered_set<string> ss(state_toks.begin(), state_toks.end());
    bool hit = false;
    for (const auto &tkn : inst_toks) if (ss.count(tkn)) hit = true;
    if (hit) yes = clamp01(yes * 0.85);
  }
  AnswerJson a;
  a.type = "noul";
  std::ostringstream os;
  os << "{\"type\":\"noul\",\"noul\":" << round4(clamp01(yes)) << "}";
  a.body = os.str();
  return a;
}

static AnswerJson eval_question(const string &state_text, const J &q, const Weights &w) {
  const J *type = q.get("type");
  string t = type ? type->as_str() : "noul";
  if (t == "choice") return eval_choice(state_text, q, w);
  if (t == "score") return eval_score(state_text, q, w);
  return eval_noul(state_text, q, w);
}

static int approx_tokens(const string &text) {
  if (text.empty()) return 0;
  int words = 0;
  bool in = false;
  for (char c : text) {
    if (c != ' ' && c != '\n' && c != '\t') {
      if (!in) {
        words++;
        in = true;
      }
    } else {
      in = false;
    }
  }
  return std::max(1, (int)std::round(words * 1.35 + text.size() / 18.0));
}

static string eval_request(const J &req) {
  string model = "system-one";
  if (const J *m = req.get("model")) model = canonical_model(m->as_str());
  const J *state = req.get("state");
  const J *questions = req.get("questions");
  if (!state || !questions || questions->type != J::OBJ) {
    return "{\"error\":{\"type\":\"invalid_request\",\"message\":\"state and questions required\"}}";
  }
  Weights w = weights_for(model);
  auto t0 = std::chrono::steady_clock::now();

  vector<std::pair<string, const J *>> items;
  for (const auto &kv : questions->o) items.push_back({kv.first, &kv.second});

  vector<AnswerJson> answers(items.size());
  auto work = [&](size_t i) {
    const J &q = *items[i].second;
    string st = q_state(*state, q);
    answers[i] = eval_question(st, q, w);
  };

  if (items.size() >= 4) {
    vector<std::thread> pool;
    size_t nthreads = std::min(items.size(), (size_t)std::max(2u, std::thread::hardware_concurrency()));
    vector<size_t> next(1, 0);
    std::mutex mu;
    for (size_t t = 0; t < nthreads; t++) {
      pool.emplace_back([&]() {
        for (;;) {
          size_t i;
          {
            std::lock_guard<std::mutex> g(mu);
            i = next[0]++;
          }
          if (i >= items.size()) break;
          work(i);
        }
      });
    }
    for (auto &th : pool) th.join();
  } else {
    for (size_t i = 0; i < items.size(); i++) work(i);
  }

  auto t1 = std::chrono::steady_clock::now();
  double ms = std::chrono::duration<double, std::milli>(t1 - t0).count();
  ms = std::round(ms * 10) / 10.0;

  string qtext;
  for (const auto &kv : questions->o) qtext += flatten(kv.second.get("instructions")).positive + " ";
  int in_tok = approx_tokens(state_prose(*state) + " " + qtext);
  int out_tok = 0;
  for (const auto &a : answers) out_tok += approx_tokens(a.body);

  std::ostringstream os;
  os << "{\"model\":" << json_str(model) << ",\"answers\":{";
  for (size_t i = 0; i < items.size(); i++) {
    if (i) os << ",";
    os << json_str(items[i].first) << ":" << answers[i].body;
  }
  os << "},\"usage\":{\"input_tokens\":" << in_tok << ",\"output_tokens\":" << out_tok
     << "},\"latency_ms\":" << ms << "}";
  return os.str();
}

int openjev_eval(const char *json_in, char *out, int out_cap) {
  if (!json_in || !out || out_cap <= 1) return -1;
  Parser p(json_in);
  J req = p.parse();
  if (!p.ok || req.type != J::OBJ) return -2;
  string s = eval_request(req);
  if ((int)s.size() + 1 > out_cap) return -1;
  std::memcpy(out, s.c_str(), s.size() + 1);
  return (int)s.size();
}

char *openjev_eval_dup(const char *json_in) {
  if (!json_in) return nullptr;
  Parser p(json_in);
  J req = p.parse();
  if (!p.ok || req.type != J::OBJ) return nullptr;
  string s = eval_request(req);
  char *buf = (char *)std::malloc(s.size() + 1);
  if (!buf) return nullptr;
  std::memcpy(buf, s.c_str(), s.size() + 1);
  return buf;
}

void openjev_free(char *p) { std::free(p); }
