import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { rewriteApiAlias } from "./api-alias.ts";

describe("rewriteApiAlias", () => {
  it("maps /v1/systemone onto the /api/v1 handler, keeping the query", () => {
    const out = rewriteApiAlias(new URL("http://localhost:8080/v1/systemone?x=1"));
    assert.equal(out?.href, "http://localhost:8080/api/v1/systemone?x=1");
  });

  it("maps the bare /v1 index", () => {
    assert.equal(rewriteApiAlias(new URL("http://h/v1"))?.pathname, "/api/v1");
  });

  it("leaves other paths alone and does not mutate the input", () => {
    const input = new URL("http://h/api/v1/models");
    assert.equal(rewriteApiAlias(input), undefined);
    assert.equal(rewriteApiAlias(new URL("http://h/v10/x")), undefined);
    assert.equal(rewriteApiAlias(new URL("http://h/playground")), undefined);
    const orig = new URL("http://h/v1/models");
    rewriteApiAlias(orig);
    assert.equal(orig.pathname, "/v1/models");
  });
});
