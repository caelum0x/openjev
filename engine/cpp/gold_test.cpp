#include "openjev.hpp"

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <iostream>
#include <sstream>
#include <string>

static std::string slurp(const char *path) {
  std::ifstream in(path, std::ios::binary);
  if (!in) return "";
  std::ostringstream ss;
  ss << in.rdbuf();
  return ss.str();
}

/* Very small JSON field extractors for gold checks. */
static bool extract_choice(const std::string &json, const std::string &id, std::string *choice, double *p) {
  std::string key = "\"" + id + "\"";
  auto at = json.find(key);
  if (at == std::string::npos) return false;
  auto cpos = json.find("\"choice\"", at);
  if (cpos == std::string::npos || cpos > at + 800) return false;
  auto q1 = json.find('"', cpos + 8);
  q1 = json.find('"', q1 + 1);
  auto q2 = json.find('"', q1 + 1);
  if (q1 == std::string::npos || q2 == std::string::npos) return false;
  *choice = json.substr(q1 + 1, q2 - q1 - 1);
  if (p) {
    auto pp = json.find("\"" + *choice + "\":", q2);
    if (pp != std::string::npos && pp < q2 + 400) {
      *p = std::atof(json.c_str() + pp + choice->size() + 3);
    }
  }
  return true;
}

static bool extract_noul(const std::string &json, const std::string &id, double *noul) {
  std::string key = "\"" + id + "\"";
  auto at = json.find(key);
  if (at == std::string::npos) return false;
  auto np = json.find("\"noul\"", at);
  if (np == std::string::npos || np > at + 200) return false;
  auto colon = json.find(':', np);
  *noul = std::atof(json.c_str() + colon + 1);
  return true;
}

static bool extract_score(const std::string &json, const std::string &id, double *score) {
  std::string key = "\"" + id + "\"";
  auto at = json.find(key);
  if (at == std::string::npos) return false;
  auto sp = json.find("\"score\"", at);
  if (sp == std::string::npos || sp > at + 400) return false;
  auto colon = json.find(':', sp);
  *score = std::atof(json.c_str() + colon + 1);
  return true;
}

int main(int argc, char **argv) {
  const char *path = argc > 1 ? argv[1] : "../gold.json";
  std::string gold = slurp(path);
  if (gold.empty()) {
    std::cerr << "cannot read " << path << "\n";
    return 2;
  }

  /* Walk each object in the top-level array by splitting on `"id":` */
  int passed = 0, failed = 0, total = 0;
  size_t pos = 0;
  while ((pos = gold.find("\"id\":", pos)) != std::string::npos) {
    size_t q1 = gold.find('"', pos + 5);
    size_t q2 = gold.find('"', q1 + 1);
    std::string id = gold.substr(q1 + 1, q2 - q1 - 1);

    size_t obj_start = gold.rfind('{', pos);
    size_t next_id = gold.find("\"id\":", q2);
    size_t obj_end = next_id == std::string::npos ? gold.rfind('}') : gold.rfind('}', next_id);
    /* Better: find matching — we send the whole case object by locating state/questions/expect. */
    size_t expect_at = gold.find("\"expect\"", q2);
    if (expect_at == std::string::npos) break;
    size_t case_end = gold.find("\n  },", expect_at);
    if (case_end == std::string::npos) case_end = gold.size() - 1;
    else case_end += 4;

    std::string cas = gold.substr(obj_start, case_end - obj_start);
    /* Build a systemone request from state + questions (strip expect). */
    size_t st = cas.find("\"state\"");
    size_t qs = cas.find("\"questions\"");
    size_t ex = cas.find("\"expect\"");
    if (st == std::string::npos || qs == std::string::npos || ex == std::string::npos) {
      pos = q2;
      continue;
    }
    std::string state_q = cas.substr(st, ex - st);
    while (!state_q.empty() && (state_q.back() == ',' || state_q.back() == ' ' || state_q.back() == '\n'))
      state_q.pop_back();
    std::string req = std::string("{\"model\":\"system-one\",") + state_q + "}";

    char *out = openjev_eval_dup(req.c_str());
    if (!out) {
      std::cerr << id << " EVAL FAIL\n";
      failed++;
      total++;
      pos = q2;
      continue;
    }
    std::string resp(out);
    openjev_free(out);

    std::string expect_block = cas.substr(ex);
    bool ok = true;
    std::string detail;

    /* choice expect */
    size_t c = 0;
    while ((c = expect_block.find("\"choice\"", c)) != std::string::npos) {
      auto idp = expect_block.find("\"id\"", c);
      auto vp = expect_block.find("\"value\"", c);
      if (idp == std::string::npos || vp == std::string::npos || idp > c + 200) {
        c += 8;
        continue;
      }
      auto iq1 = expect_block.find('"', idp + 4);
      iq1 = expect_block.find('"', iq1 + 1);
      auto iq2 = expect_block.find('"', iq1 + 1);
      std::string qid = expect_block.substr(iq1 + 1, iq2 - iq1 - 1);
      auto vq1 = expect_block.find('"', vp + 6);
      vq1 = expect_block.find('"', vq1 + 1);
      auto vq2 = expect_block.find('"', vq1 + 1);
      std::string want = expect_block.substr(vq1 + 1, vq2 - vq1 - 1);
      double minp = 0;
      auto mp = expect_block.find("\"minP\"", c);
      if (mp != std::string::npos && mp < vq2 + 80) minp = std::atof(expect_block.c_str() + expect_block.find(':', mp) + 1);
      std::string got;
      double gp = 0;
      if (!extract_choice(resp, qid, &got, &gp) || got != want || (minp && gp < minp)) {
        ok = false;
        detail += " choice " + qid + " want=" + want + " got=" + got;
      }
      c = vq2;
    }
    c = 0;
    while ((c = expect_block.find("\"noul\"", c)) != std::string::npos) {
      auto idp = expect_block.find("\"id\"", c);
      if (idp == std::string::npos || idp > c + 120) {
        c += 6;
        continue;
      }
      auto iq1 = expect_block.find('"', idp + 4);
      iq1 = expect_block.find('"', iq1 + 1);
      auto iq2 = expect_block.find('"', iq1 + 1);
      std::string qid = expect_block.substr(iq1 + 1, iq2 - iq1 - 1);
      double mn = -1, mx = 2;
      auto mnp = expect_block.find("\"min\"", c);
      auto mxp = expect_block.find("\"max\"", c);
      if (mnp != std::string::npos && mnp < c + 180) mn = std::atof(expect_block.c_str() + expect_block.find(':', mnp) + 1);
      if (mxp != std::string::npos && mxp < c + 220) mx = std::atof(expect_block.c_str() + expect_block.find(':', mxp) + 1);
      double got = -1;
      if (!extract_noul(resp, qid, &got) || got < mn || got > mx) {
        ok = false;
        detail += " noul " + qid + " got=" + std::to_string(got);
      }
      c = iq2;
    }
    c = 0;
    while ((c = expect_block.find("\"score\"", c)) != std::string::npos) {
      auto idp = expect_block.find("\"id\"", c);
      if (idp == std::string::npos || idp > c + 120) {
        c += 7;
        continue;
      }
      auto iq1 = expect_block.find('"', idp + 4);
      iq1 = expect_block.find('"', iq1 + 1);
      auto iq2 = expect_block.find('"', iq1 + 1);
      std::string qid = expect_block.substr(iq1 + 1, iq2 - iq1 - 1);
      double mn = -1, mx = 99;
      auto mnp = expect_block.find("\"min\"", c);
      auto mxp = expect_block.find("\"max\"", c);
      if (mnp != std::string::npos && mnp < c + 180) mn = std::atof(expect_block.c_str() + expect_block.find(':', mnp) + 1);
      if (mxp != std::string::npos && mxp < c + 220) mx = std::atof(expect_block.c_str() + expect_block.find(':', mxp) + 1);
      double got = -1;
      if (!extract_score(resp, qid, &got) || got < mn || got > mx) {
        ok = false;
        detail += " score " + qid + " got=" + std::to_string(got);
      }
      c = iq2 + 1;
    }

    total++;
    if (ok) {
      passed++;
      std::cout << "ok   " << id << "\n";
    } else {
      failed++;
      std::cout << "FAIL " << id << detail << "\n";
    }
    pos = q2;
  }

  std::cout << passed << "/" << total << " passed\n";
  return failed ? 1 : 0;
}
