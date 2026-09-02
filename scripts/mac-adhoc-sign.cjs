"use strict";

async function sign(configuration, _packager, signAsyncOverride) {
  const signAsync = signAsyncOverride || require("@electron/osx-sign").signAsync;
  return signAsync({
    ...configuration,
    identity: "-",
    identityValidation: false,
    keychain: undefined,
    provisioningProfile: undefined,
    preEmbedProvisioningProfile: false
  });
}

module.exports = sign;
module.exports.sign = sign;
