const { validateExchangePartyFields, validateRequesterPartyFields } = require("@services/exchange-service");

async function createCheck(check) {
    await validateExchangePartyFields(to, to.request, "to", "request");
}