import assert from "node:assert/strict";
import { test } from "node:test";
import { htmlToText } from "../src/tools/html.ts";
import { isPrivateAddress, safeFetch } from "../src/tools/net.ts";
import { ToolError } from "../src/tools/types.ts";

test("private, loopback, link-local and mapped addresses are blocked", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"]) {
    assert.ok(isPrivateAddress(ip), ip);
  }
  for (const ip of ["8.8.8.8", "172.32.0.1", "151.101.1.69", "2606:4700::1111"]) {
    assert.ok(!isPrivateAddress(ip), ip);
  }
});

test("safeFetch refuses local services and non-http schemes without connecting", async () => {
  const signal = new AbortController().signal;
  for (const url of ["http://localhost:7474", "http://127.0.0.1:7687", "http://169.254.169.254/latest/meta-data", "file:///etc/passwd", "ftp://example.com/x", "http://user:pw@example.com/"]) {
    await assert.rejects(safeFetch(url, { signal }), ToolError, url);
  }
});

test("htmlToText keeps the article text and drops scripts and chrome", () => {
  const { title, text } = htmlToText(
    `<html><head><title>On Writing &amp; Tokens</title><script>evil()</script></head>
     <body><nav>Menu</nav><article><h1>Heading</h1><p>First&nbsp;para &#8220;quoted&#8221;.</p><p>Second</p></article><footer>©</footer></body></html>`,
  );
  assert.equal(title, "On Writing & Tokens");
  assert.match(text, /Heading\nFirst para “quoted”\.\nSecond/);
  assert.doesNotMatch(text, /evil|Menu|©/);
});
