"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const sign = require("../scripts/mac-adhoc-sign.cjs");

test("macOS-сборка всегда получает ad-hoc-подпись без сертификата", async () => {
  let received;
  await sign({
    app: "/tmp/Meeting Notes.app",
    identity: "чужой сертификат",
    keychain: "/tmp/keychain",
    provisioningProfile: "/tmp/profile"
  }, null, async (options) => {
    received = options;
  });

  assert.equal(received.identity, "-");
  assert.equal(received.identityValidation, false);
  assert.equal(received.keychain, undefined);
  assert.equal(received.provisioningProfile, undefined);
  assert.equal(received.preEmbedProvisioningProfile, false);
});
