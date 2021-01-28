// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

// index.js is used to setup and configure your bot

// Import required packages
const path = require('path');
const restify = require('restify');

// Import required bot services. See https://aka.ms/bot-services to learn more about the different parts of a bot.
const { BotFrameworkAdapter, ConversationState, MemoryStorage, UserState } = require('botbuilder');
const { QnAMaker } = require('botbuilder-ai');

const { QnABot } = require('./bots/QnABot');
const { RootDialog } = require('./dialogs/rootDialog');

// Note: Ensure you have a .env file and include QnAMakerKnowledgeBaseId, QnAMakerEndpointKey and QnAMakerHost.
const ENV_FILE = path.join(__dirname, '.env');
require('dotenv').config({ path: ENV_FILE });

// Create HTTP server.
const server = restify.createServer();
server.listen(process.env.port || process.env.PORT || 3978, function() {
    console.log(`\n${ server.name } listening to ${ server.url }.`);
    console.log('\nGet Bot Framework Emulator: https://aka.ms/botframework-emulator');
    console.log('\nTo talk to your bot, open the emulator select "Open Bot"');
});

// Create adapter.
// See https://aka.ms/about-bot-adapter to learn more about adapters.
const adapter = new BotFrameworkAdapter({
    appId: process.env.MicrosoftAppId,
    appPassword: process.env.MicrosoftAppPassword,
    openIdMetadata: process.env.BotOpenIdMetadata
});

// Catch-all for errors.
adapter.onTurnError = async (context, error) => {
    // This check writes out errors to console log .vs. app insights.
    // NOTE: In production environment, you should consider logging this to Azure
    //       application insights.
    console.error(`\n [onTurnError] unhandled error: ${ error }`);

    // Send a trace activity, which will be displayed in Bot Framework Emulator
    await context.sendTraceActivity(
        'OnTurnError Trace',
        `${ error }`,
        'https://www.botframework.com/schemas/error',
        'TurnError'
    );

    // Send a message to the user
    await context.sendActivity('The bot encountered an error or bug.');
    await context.sendActivity('To continue to run this bot, please fix the bot source code.');
};

// Define the state store for your bot. See https://aka.ms/about-bot-state to learn more about using MemoryStorage.
// A bot requires a state storage system to persist the dialog and user state between messages.
const memoryStorage = new MemoryStorage();

// Create conversation and user state with in-memory storage provider.
const conversationState = new ConversationState(memoryStorage);
const userState = new UserState(memoryStorage);

var endpointHostName = process.env.QnAEndpointHostName;
if (!endpointHostName.startsWith('https://')) {
    endpointHostName = 'https://' + endpointHostName;
}

if (!endpointHostName.includes('/v5.0') && !endpointHostName.endsWith('/qnamaker')) {
    endpointHostName = endpointHostName + '/qnamaker';
}


// Create the main dialog.
const dialog = new RootDialog(process.env.QnAKnowledgebaseId, process.env.QnAAuthKey, endpointHostName);

// Create the bot's main handler.
const bot = new QnABot(conversationState, userState, dialog);

// Listen for incoming requests.
server.post('/api/messages', (req, res) => {
    adapter.processActivity(req, res, async (turnContext) => {
        // Route the message to the bot's main handler.
        await bot.run(turnContext);
    });
});

// SIG // Begin signature block
// SIG // MIInNgYJKoZIhvcNAQcCoIInJzCCJyMCAQExDzANBglg
// SIG // hkgBZQMEAgEFADB3BgorBgEEAYI3AgEEoGkwZzAyBgor
// SIG // BgEEAYI3AgEeMCQCAQEEEBDgyQbOONQRoqMAEEvTUJAC
// SIG // AQACAQACAQACAQACAQAwMTANBglghkgBZQMEAgEFAAQg
// SIG // 0wdfXPFu4YTjbOEGXkUL8OHWdCmM/7RjrWAYT0kVyTWg
// SIG // ghFlMIIIdzCCB1+gAwIBAgITNgAAAQl3quySnj9vOwAB
// SIG // AAABCTANBgkqhkiG9w0BAQsFADBBMRMwEQYKCZImiZPy
// SIG // LGQBGRYDR0JMMRMwEQYKCZImiZPyLGQBGRYDQU1FMRUw
// SIG // EwYDVQQDEwxBTUUgQ1MgQ0EgMDEwHhcNMjAwMjA5MTMy
// SIG // MzMxWhcNMjEwMjA4MTMyMzMxWjAkMSIwIAYDVQQDExlN
// SIG // aWNyb3NvZnQgQXp1cmUgQ29kZSBTaWduMIIBIjANBgkq
// SIG // hkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAmGzl5pbMxZ7g
// SIG // jwTFFegQtSdUDiO/nKijbcxfE6VYIbZiqs912OOm/2MT
// SIG // h8U0KfSensJyyxMwtrT+QAMfk8aq9R6Tcutw9lPFmwbk
// SIG // aVwZNG2/H/MayaCuyFbUiYtHTVwkNBP1wwsOhAEZQ62T
// SIG // 30WEdusZNXgh6F+nVgUis5K0LjgJHE6JlNHYhVSltTuQ
// SIG // O+21xshfpd9XgeRsi42j3edhuhsyQSGGCgLa31kXR9C3
// SIG // ovyz6k3Jtc94CzC9ARikTb8YuDNtY2QRPS8Ar5CCiyGY
// SIG // i/zzOiD13QlYXr8U3432bgfxhKdElpi/hHUaHnsdPOLI
// SIG // jfCLXSz3YOob6al7Hv4nSwIDAQABo4IFgzCCBX8wKQYJ
// SIG // KwYBBAGCNxUKBBwwGjAMBgorBgEEAYI3WwEBMAoGCCsG
// SIG // AQUFBwMDMD0GCSsGAQQBgjcVBwQwMC4GJisGAQQBgjcV
// SIG // CIaQ4w2E1bR4hPGLPoWb3RbOnRKBYIPdzWaGlIwyAgFk
// SIG // AgEMMIICdgYIKwYBBQUHAQEEggJoMIICZDBiBggrBgEF
// SIG // BQcwAoZWaHR0cDovL2NybC5taWNyb3NvZnQuY29tL3Br
// SIG // aWluZnJhL0NlcnRzL0JZMlBLSUNTQ0EwMS5BTUUuR0JM
// SIG // X0FNRSUyMENTJTIwQ0ElMjAwMSgxKS5jcnQwUgYIKwYB
// SIG // BQUHMAKGRmh0dHA6Ly9jcmwxLmFtZS5nYmwvYWlhL0JZ
// SIG // MlBLSUNTQ0EwMS5BTUUuR0JMX0FNRSUyMENTJTIwQ0El
// SIG // MjAwMSgxKS5jcnQwUgYIKwYBBQUHMAKGRmh0dHA6Ly9j
// SIG // cmwyLmFtZS5nYmwvYWlhL0JZMlBLSUNTQ0EwMS5BTUUu
// SIG // R0JMX0FNRSUyMENTJTIwQ0ElMjAwMSgxKS5jcnQwUgYI
// SIG // KwYBBQUHMAKGRmh0dHA6Ly9jcmwzLmFtZS5nYmwvYWlh
// SIG // L0JZMlBLSUNTQ0EwMS5BTUUuR0JMX0FNRSUyMENTJTIw
// SIG // Q0ElMjAwMSgxKS5jcnQwUgYIKwYBBQUHMAKGRmh0dHA6
// SIG // Ly9jcmw0LmFtZS5nYmwvYWlhL0JZMlBLSUNTQ0EwMS5B
// SIG // TUUuR0JMX0FNRSUyMENTJTIwQ0ElMjAwMSgxKS5jcnQw
// SIG // ga0GCCsGAQUFBzAChoGgbGRhcDovLy9DTj1BTUUlMjBD
// SIG // UyUyMENBJTIwMDEsQ049QUlBLENOPVB1YmxpYyUyMEtl
// SIG // eSUyMFNlcnZpY2VzLENOPVNlcnZpY2VzLENOPUNvbmZp
// SIG // Z3VyYXRpb24sREM9QU1FLERDPUdCTD9jQUNlcnRpZmlj
// SIG // YXRlP2Jhc2U/b2JqZWN0Q2xhc3M9Y2VydGlmaWNhdGlv
// SIG // bkF1dGhvcml0eTAdBgNVHQ4EFgQUhX+XKjFG3imHupcw
// SIG // W0fynaqQrlIwDgYDVR0PAQH/BAQDAgeAMFAGA1UdEQRJ
// SIG // MEekRTBDMSkwJwYDVQQLEyBNaWNyb3NvZnQgT3BlcmF0
// SIG // aW9ucyBQdWVydG8gUmljbzEWMBQGA1UEBRMNMjM2MTY3
// SIG // KzQ1Nzc4OTCCAdQGA1UdHwSCAcswggHHMIIBw6CCAb+g
// SIG // ggG7hjxodHRwOi8vY3JsLm1pY3Jvc29mdC5jb20vcGtp
// SIG // aW5mcmEvQ1JML0FNRSUyMENTJTIwQ0ElMjAwMS5jcmyG
// SIG // Lmh0dHA6Ly9jcmwxLmFtZS5nYmwvY3JsL0FNRSUyMENT
// SIG // JTIwQ0ElMjAwMS5jcmyGLmh0dHA6Ly9jcmwyLmFtZS5n
// SIG // YmwvY3JsL0FNRSUyMENTJTIwQ0ElMjAwMS5jcmyGLmh0
// SIG // dHA6Ly9jcmwzLmFtZS5nYmwvY3JsL0FNRSUyMENTJTIw
// SIG // Q0ElMjAwMS5jcmyGLmh0dHA6Ly9jcmw0LmFtZS5nYmwv
// SIG // Y3JsL0FNRSUyMENTJTIwQ0ElMjAwMS5jcmyGgbpsZGFw
// SIG // Oi8vL0NOPUFNRSUyMENTJTIwQ0ElMjAwMSxDTj1CWTJQ
// SIG // S0lDU0NBMDEsQ049Q0RQLENOPVB1YmxpYyUyMEtleSUy
// SIG // MFNlcnZpY2VzLENOPVNlcnZpY2VzLENOPUNvbmZpZ3Vy
// SIG // YXRpb24sREM9QU1FLERDPUdCTD9jZXJ0aWZpY2F0ZVJl
// SIG // dm9jYXRpb25MaXN0P2Jhc2U/b2JqZWN0Q2xhc3M9Y1JM
// SIG // RGlzdHJpYnV0aW9uUG9pbnQwHwYDVR0jBBgwFoAUG2ai
// SIG // Gfyb66XahI8YmOkQpMN7kr0wHwYDVR0lBBgwFgYKKwYB
// SIG // BAGCN1sBAQYIKwYBBQUHAwMwDQYJKoZIhvcNAQELBQAD
// SIG // ggEBAEGHe+svgcjFAN/gO1rBxVSWabhMofX6gzoUN39f
// SIG // CwmrTUqgTVD9D2JRFYpliVL6690QB1gRtp694p0Wmor7
// SIG // 73kedS5DNUx9PfKlY7/uzDXMLvCJENndPjqAH0F0rJxT
// SIG // DV7CQWbE+lt87HHSumAhZsqz5GDiNDUz4aF/omb4cLZk
// SIG // fcfVCN3Q63fy4PvS/h+Qp+FCNNJZZjPPVwaYnIdr80Ef
// SIG // TftyffEyZ+WMXyF6A2IV+sx7vnCopTo7NrsIN8Ai91Xp
// SIG // H5ccjnshQu4RU0RVgHViifkDO/FghThJQd/GodVON8JO
// SIG // 7vga7klxP4F8hlIuTSH1LD5hBP0vJfVHsKCD3CMwggjm
// SIG // MIIGzqADAgECAhMfAAAAFLTFH8bygL5xAAAAAAAUMA0G
// SIG // CSqGSIb3DQEBCwUAMDwxEzARBgoJkiaJk/IsZAEZFgNH
// SIG // QkwxEzARBgoJkiaJk/IsZAEZFgNBTUUxEDAOBgNVBAMT
// SIG // B2FtZXJvb3QwHhcNMTYwOTE1MjEzMzAzWhcNMjEwOTE1
// SIG // MjE0MzAzWjBBMRMwEQYKCZImiZPyLGQBGRYDR0JMMRMw
// SIG // EQYKCZImiZPyLGQBGRYDQU1FMRUwEwYDVQQDEwxBTUUg
// SIG // Q1MgQ0EgMDEwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAw
// SIG // ggEKAoIBAQDVV4EC1vn60PcbgLndN80k3GZh/OGJcq0p
// SIG // DNIbG5q/rrRtNLVUR4MONKcWGyaeVvoaQ8J5iYInBaBk
// SIG // az7ehYnzJp3f/9Wg/31tcbxrPNMmZPY8UzXIrFRdQmCL
// SIG // sj3LcLiWX8BN8HBsYZFcP7Y92R2VWnEpbN40Q9XBsK3F
// SIG // aNSEevoRzL1Ho7beP7b9FJlKB/Nhy0PMNaE1/Q+8Y9+W
// SIG // bfU9KTj6jNxrffv87O7T6doMqDmL/MUeF9IlmSrl088b
// SIG // oLzAOt2LAeHobkgasx3ZBeea8R+O2k+oT4bwx5ZuzNpb
// SIG // GXESNAlALo8HCf7xC3hWqVzRqbdnd8HDyTNG6c6zwyf/
// SIG // AgMBAAGjggTaMIIE1jAQBgkrBgEEAYI3FQEEAwIBATAj
// SIG // BgkrBgEEAYI3FQIEFgQUkfwzzkKe9pPm4n1U1wgYu7jX
// SIG // cWUwHQYDVR0OBBYEFBtmohn8m+ul2oSPGJjpEKTDe5K9
// SIG // MIIBBAYDVR0lBIH8MIH5BgcrBgEFAgMFBggrBgEFBQcD
// SIG // AQYIKwYBBQUHAwIGCisGAQQBgjcUAgEGCSsGAQQBgjcV
// SIG // BgYKKwYBBAGCNwoDDAYJKwYBBAGCNxUGBggrBgEFBQcD
// SIG // CQYIKwYBBQUIAgIGCisGAQQBgjdAAQEGCysGAQQBgjcK
// SIG // AwQBBgorBgEEAYI3CgMEBgkrBgEEAYI3FQUGCisGAQQB
// SIG // gjcUAgIGCisGAQQBgjcUAgMGCCsGAQUFBwMDBgorBgEE
// SIG // AYI3WwEBBgorBgEEAYI3WwIBBgorBgEEAYI3WwMBBgor
// SIG // BgEEAYI3WwUBBgorBgEEAYI3WwQBBgorBgEEAYI3WwQC
// SIG // MBkGCSsGAQQBgjcUAgQMHgoAUwB1AGIAQwBBMAsGA1Ud
// SIG // DwQEAwIBhjASBgNVHRMBAf8ECDAGAQH/AgEAMB8GA1Ud
// SIG // IwQYMBaAFCleUV5krjS566ycDaeMdQHRCQsoMIIBaAYD
// SIG // VR0fBIIBXzCCAVswggFXoIIBU6CCAU+GI2h0dHA6Ly9j
// SIG // cmwxLmFtZS5nYmwvY3JsL2FtZXJvb3QuY3JshjFodHRw
// SIG // Oi8vY3JsLm1pY3Jvc29mdC5jb20vcGtpaW5mcmEvY3Js
// SIG // L2FtZXJvb3QuY3JshiNodHRwOi8vY3JsMi5hbWUuZ2Js
// SIG // L2NybC9hbWVyb290LmNybIYjaHR0cDovL2NybDMuYW1l
// SIG // LmdibC9jcmwvYW1lcm9vdC5jcmyGgapsZGFwOi8vL0NO
// SIG // PWFtZXJvb3QsQ049QU1FUk9PVCxDTj1DRFAsQ049UHVi
// SIG // bGljJTIwS2V5JTIwU2VydmljZXMsQ049U2VydmljZXMs
// SIG // Q049Q29uZmlndXJhdGlvbixEQz1BTUUsREM9R0JMP2Nl
// SIG // cnRpZmljYXRlUmV2b2NhdGlvbkxpc3Q/YmFzZT9vYmpl
// SIG // Y3RDbGFzcz1jUkxEaXN0cmlidXRpb25Qb2ludDCCAasG
// SIG // CCsGAQUFBwEBBIIBnTCCAZkwNwYIKwYBBQUHMAKGK2h0
// SIG // dHA6Ly9jcmwxLmFtZS5nYmwvYWlhL0FNRVJPT1RfYW1l
// SIG // cm9vdC5jcnQwRwYIKwYBBQUHMAKGO2h0dHA6Ly9jcmwu
// SIG // bWljcm9zb2Z0LmNvbS9wa2lpbmZyYS9jZXJ0cy9BTUVS
// SIG // T09UX2FtZXJvb3QuY3J0MDcGCCsGAQUFBzAChitodHRw
// SIG // Oi8vY3JsMi5hbWUuZ2JsL2FpYS9BTUVST09UX2FtZXJv
// SIG // b3QuY3J0MDcGCCsGAQUFBzAChitodHRwOi8vY3JsMy5h
// SIG // bWUuZ2JsL2FpYS9BTUVST09UX2FtZXJvb3QuY3J0MIGi
// SIG // BggrBgEFBQcwAoaBlWxkYXA6Ly8vQ049YW1lcm9vdCxD
// SIG // Tj1BSUEsQ049UHVibGljJTIwS2V5JTIwU2VydmljZXMs
// SIG // Q049U2VydmljZXMsQ049Q29uZmlndXJhdGlvbixEQz1B
// SIG // TUUsREM9R0JMP2NBQ2VydGlmaWNhdGU/YmFzZT9vYmpl
// SIG // Y3RDbGFzcz1jZXJ0aWZpY2F0aW9uQXV0aG9yaXR5MA0G
// SIG // CSqGSIb3DQEBCwUAA4ICAQAot0qGmo8fpAFozcIA6pCL
// SIG // ygDhZB5ktbdA5c2ZabtQDTXwNARrXJOoRBu4Pk6VHVa7
// SIG // 8Xbz0OZc1N2xkzgZMoRpl6EiJVoygu8Qm27mHoJPJ9ao
// SIG // 9603I4mpHWwaqh3RfCfn8b/NxNhLGfkrc3wp2VwOtkAj
// SIG // J+rfJoQlgcacD14n9/VGt9smB6j9ECEgJy0443B+mwFd
// SIG // yCJO5OaUP+TQOqiC/MmA+r0Y6QjJf93GTsiQ/Nf+fjzi
// SIG // zTMdHggpTnxTcbWg9JCZnk4cC+AdoQBKR03kTbQfIm/n
// SIG // M3t275BjTx8j5UhyLqlqAt9cdhpNfdkn8xQz1dT6hTnL
// SIG // iowvNOPUkgbQtV+4crzKgHuHaKfJN7tufqHYbw3FnTZo
// SIG // pnTFr6f8mehco2xpU8bVKhO4i0yxdXmlC0hKGwGqdeoW
// SIG // NjdskyUyEih8xyOK47BEJb6mtn4+hi8TY/4wvuCzcvrk
// SIG // Zn0F0oXd9JbdO+ak66M9DbevNKV71YbEUnTZ81toX0Lt
// SIG // sbji4PMyhlTg/669BoHsoTg4yoC9hh8XLW2/V2lUg3+q
// SIG // HHQf/2g2I4mm5lnf1mJsu30NduyrmrDIeZ0ldqKzHAHn
// SIG // fAmyFSNzWLvrGoU9Q0ZvwRlDdoUqXbD0Hju98GL6dTew
// SIG // 3S2mcs+17DgsdargsEPm6I1lUE5iixnoEqFKWTX5j/TL
// SIG // UjGCFSkwghUlAgEBMFgwQTETMBEGCgmSJomT8ixkARkW
// SIG // A0dCTDETMBEGCgmSJomT8ixkARkWA0FNRTEVMBMGA1UE
// SIG // AxMMQU1FIENTIENBIDAxAhM2AAABCXeq7JKeP287AAEA
// SIG // AAEJMA0GCWCGSAFlAwQCAQUAoIGuMBkGCSqGSIb3DQEJ
// SIG // AzEMBgorBgEEAYI3AgEEMBwGCisGAQQBgjcCAQsxDjAM
// SIG // BgorBgEEAYI3AgEVMC8GCSqGSIb3DQEJBDEiBCCj71fN
// SIG // cfPO/BBGDw07SBJhHzawsdf+t1v8dmU3CHeZ5DBCBgor
// SIG // BgEEAYI3AgEMMTQwMqAUgBIATQBpAGMAcgBvAHMAbwBm
// SIG // AHShGoAYaHR0cDovL3d3dy5taWNyb3NvZnQuY29tMA0G
// SIG // CSqGSIb3DQEBAQUABIIBABMv4mNEN9oWhs4ppjun94OU
// SIG // mr47U+nbhiPRnEddrMiAm6jeVG/NF+5PxJfSAEboyVwn
// SIG // u/BDVuKOWrOXvLF3Ifyuq1R086T1qEky0p1qMVeQSFMZ
// SIG // wwi+X/R48P8qLVn1xUpzwEl1AYmBZ57zpjVUryLNCdO3
// SIG // B7rkVv4mQTVvcAN/DXezFFE7dJmpZxV/u0JRuS8n+Ay0
// SIG // 86sxpJRDwzO/pR8mrJcCJudIfz6+RsMO/B6GV9pD8+7D
// SIG // t+qfc5NphOkxqnQcMUCCgb73on4sRnWMbCX8FZDs5VIz
// SIG // Vhv+qfUSgXYybSB1QNnRuCswwvKedpvAGZ8f18HQv4QT
// SIG // YAwlPYS7GlehghLxMIIS7QYKKwYBBAGCNwMDATGCEt0w
// SIG // ghLZBgkqhkiG9w0BBwKgghLKMIISxgIBAzEPMA0GCWCG
// SIG // SAFlAwQCAQUAMIIBVQYLKoZIhvcNAQkQAQSgggFEBIIB
// SIG // QDCCATwCAQEGCisGAQQBhFkKAwEwMTANBglghkgBZQME
// SIG // AgEFAAQgBgP98e00b/XMpPYAOxIXtnD5QTwhImljQ1zQ
// SIG // AuoEhmECBl+76zcTIRgTMjAyMDEyMTAxODU0MjkuNjk4
// SIG // WjAEgAIB9KCB1KSB0TCBzjELMAkGA1UEBhMCVVMxEzAR
// SIG // BgNVBAgTCldhc2hpbmd0b24xEDAOBgNVBAcTB1JlZG1v
// SIG // bmQxHjAcBgNVBAoTFU1pY3Jvc29mdCBDb3Jwb3JhdGlv
// SIG // bjEpMCcGA1UECxMgTWljcm9zb2Z0IE9wZXJhdGlvbnMg
// SIG // UHVlcnRvIFJpY28xJjAkBgNVBAsTHVRoYWxlcyBUU1Mg
// SIG // RVNOOjMyQkQtRTNENS0zQjFEMSUwIwYDVQQDExxNaWNy
// SIG // b3NvZnQgVGltZS1TdGFtcCBTZXJ2aWNloIIORDCCBPUw
// SIG // ggPdoAMCAQICEzMAAAEuqNIZB5P0a+gAAAAAAS4wDQYJ
// SIG // KoZIhvcNAQELBQAwfDELMAkGA1UEBhMCVVMxEzARBgNV
// SIG // BAgTCldhc2hpbmd0b24xEDAOBgNVBAcTB1JlZG1vbmQx
// SIG // HjAcBgNVBAoTFU1pY3Jvc29mdCBDb3Jwb3JhdGlvbjEm
// SIG // MCQGA1UEAxMdTWljcm9zb2Z0IFRpbWUtU3RhbXAgUENB
// SIG // IDIwMTAwHhcNMTkxMjE5MDExNTA1WhcNMjEwMzE3MDEx
// SIG // NTA1WjCBzjELMAkGA1UEBhMCVVMxEzARBgNVBAgTCldh
// SIG // c2hpbmd0b24xEDAOBgNVBAcTB1JlZG1vbmQxHjAcBgNV
// SIG // BAoTFU1pY3Jvc29mdCBDb3Jwb3JhdGlvbjEpMCcGA1UE
// SIG // CxMgTWljcm9zb2Z0IE9wZXJhdGlvbnMgUHVlcnRvIFJp
// SIG // Y28xJjAkBgNVBAsTHVRoYWxlcyBUU1MgRVNOOjMyQkQt
// SIG // RTNENS0zQjFEMSUwIwYDVQQDExxNaWNyb3NvZnQgVGlt
// SIG // ZS1TdGFtcCBTZXJ2aWNlMIIBIjANBgkqhkiG9w0BAQEF
// SIG // AAOCAQ8AMIIBCgKCAQEArtNMolFTX3osUiMxD2r9SOk+
// SIG // HPjeblGceAcBWnZgaeLvj6W2xig7WdnnytNsmEJDwZgf
// SIG // LwHh16+Buqpg9A1TeL52ukS0Rw0tuwyvgwSrdIz687dr
// SIG // pAwV3WUNHLshAs8k0sq9wzr023uS7VjIzk2c80NxEmyd
// SIG // Rv/xjH/NxblxaOeiPyz19D3cE9/8nviozWqXYJ3NBXvg
// SIG // 8GKww/+2mkCdK43Cjwjv65avq9+kHKdJYO8l4wOtyxrr
// SIG // ZeybsNsHU2dKw8YAa3dHOUFX0pWJyLN7hTd+jhyF2gHb
// SIG // 5Au7Xs9oSaPTuqrvTQIblcmSkRg6N500WIHICkXthG9C
// SIG // s5lDTtBiIwIDAQABo4IBGzCCARcwHQYDVR0OBBYEFIaa
// SIG // iSZOC4k3u6pJNDVSEvC3VE5sMB8GA1UdIwQYMBaAFNVj
// SIG // OlyKMZDzQ3t8RhvFM2hahW1VMFYGA1UdHwRPME0wS6BJ
// SIG // oEeGRWh0dHA6Ly9jcmwubWljcm9zb2Z0LmNvbS9wa2kv
// SIG // Y3JsL3Byb2R1Y3RzL01pY1RpbVN0YVBDQV8yMDEwLTA3
// SIG // LTAxLmNybDBaBggrBgEFBQcBAQROMEwwSgYIKwYBBQUH
// SIG // MAKGPmh0dHA6Ly93d3cubWljcm9zb2Z0LmNvbS9wa2kv
// SIG // Y2VydHMvTWljVGltU3RhUENBXzIwMTAtMDctMDEuY3J0
// SIG // MAwGA1UdEwEB/wQCMAAwEwYDVR0lBAwwCgYIKwYBBQUH
// SIG // AwgwDQYJKoZIhvcNAQELBQADggEBAI3gBGqnMK6602pj
// SIG // adYkMNePfmJqJ2WC0n9uyliwBfxq0mXX0h9QojNO65JV
// SIG // Tdxpdnr9i8wxgxxuw1r/gnby6zbcro9ZkCWMiPQbxC3A
// SIG // MyVAeOsqetyvgUEDPpmq8HpKs3f9ZtvRBIr86XGxTSZ8
// SIG // PvPztHYkziDAom8foQgu4AS2PBQZIHU0qbdPCubnV8IP
// SIG // SPG9bHNpRLZ628w+uHwM2uscskFHdQe+D81dLYjN1Cfb
// SIG // TGOOxbQFQCJN/40JGnFS+7+PzQ1vX76+d6OJt+lAnYiV
// SIG // eIl0iL4dv44vdc6vwxoMNJg5pEUAh9yirdU+LgGS9ILx
// SIG // Aau+GMBlp+QTtHovkUkwggZxMIIEWaADAgECAgphCYEq
// SIG // AAAAAAACMA0GCSqGSIb3DQEBCwUAMIGIMQswCQYDVQQG
// SIG // EwJVUzETMBEGA1UECBMKV2FzaGluZ3RvbjEQMA4GA1UE
// SIG // BxMHUmVkbW9uZDEeMBwGA1UEChMVTWljcm9zb2Z0IENv
// SIG // cnBvcmF0aW9uMTIwMAYDVQQDEylNaWNyb3NvZnQgUm9v
// SIG // dCBDZXJ0aWZpY2F0ZSBBdXRob3JpdHkgMjAxMDAeFw0x
// SIG // MDA3MDEyMTM2NTVaFw0yNTA3MDEyMTQ2NTVaMHwxCzAJ
// SIG // BgNVBAYTAlVTMRMwEQYDVQQIEwpXYXNoaW5ndG9uMRAw
// SIG // DgYDVQQHEwdSZWRtb25kMR4wHAYDVQQKExVNaWNyb3Nv
// SIG // ZnQgQ29ycG9yYXRpb24xJjAkBgNVBAMTHU1pY3Jvc29m
// SIG // dCBUaW1lLVN0YW1wIFBDQSAyMDEwMIIBIjANBgkqhkiG
// SIG // 9w0BAQEFAAOCAQ8AMIIBCgKCAQEAqR0NvHcRijog7PwT
// SIG // l/X6f2mUa3RUENWlCgCChfvtfGhLLF/Fw+Vhwna3PmYr
// SIG // W/AVUycEMR9BGxqVHc4JE458YTBZsTBED/FgiIRUQwzX
// SIG // Tbg4CLNC3ZOs1nMwVyaCo0UN0Or1R4HNvyRgMlhgRvJY
// SIG // R4YyhB50YWeRX4FUsc+TTJLBxKZd0WETbijGGvmGgLvf
// SIG // YfxGwScdJGcSchohiq9LZIlQYrFd/XcfPfBXday9ikJN
// SIG // QFHRD5wGPmd/9WbAA5ZEfu/QS/1u5ZrKsajyeioKMfDa
// SIG // TgaRtogINeh4HLDpmc085y9Euqf03GS9pAHBIAmTeM38
// SIG // vMDJRF1eFpwBBU8iTQIDAQABo4IB5jCCAeIwEAYJKwYB
// SIG // BAGCNxUBBAMCAQAwHQYDVR0OBBYEFNVjOlyKMZDzQ3t8
// SIG // RhvFM2hahW1VMBkGCSsGAQQBgjcUAgQMHgoAUwB1AGIA
// SIG // QwBBMAsGA1UdDwQEAwIBhjAPBgNVHRMBAf8EBTADAQH/
// SIG // MB8GA1UdIwQYMBaAFNX2VsuP6KJcYmjRPZSQW9fOmhjE
// SIG // MFYGA1UdHwRPME0wS6BJoEeGRWh0dHA6Ly9jcmwubWlj
// SIG // cm9zb2Z0LmNvbS9wa2kvY3JsL3Byb2R1Y3RzL01pY1Jv
// SIG // b0NlckF1dF8yMDEwLTA2LTIzLmNybDBaBggrBgEFBQcB
// SIG // AQROMEwwSgYIKwYBBQUHMAKGPmh0dHA6Ly93d3cubWlj
// SIG // cm9zb2Z0LmNvbS9wa2kvY2VydHMvTWljUm9vQ2VyQXV0
// SIG // XzIwMTAtMDYtMjMuY3J0MIGgBgNVHSABAf8EgZUwgZIw
// SIG // gY8GCSsGAQQBgjcuAzCBgTA9BggrBgEFBQcCARYxaHR0
// SIG // cDovL3d3dy5taWNyb3NvZnQuY29tL1BLSS9kb2NzL0NQ
// SIG // Uy9kZWZhdWx0Lmh0bTBABggrBgEFBQcCAjA0HjIgHQBM
// SIG // AGUAZwBhAGwAXwBQAG8AbABpAGMAeQBfAFMAdABhAHQA
// SIG // ZQBtAGUAbgB0AC4gHTANBgkqhkiG9w0BAQsFAAOCAgEA
// SIG // B+aIUQ3ixuCYP4FxAz2do6Ehb7Prpsz1Mb7PBeKp/vpX
// SIG // bRkws8LFZslq3/Xn8Hi9x6ieJeP5vO1rVFcIK1GCRBL7
// SIG // uVOMzPRgEop2zEBAQZvcXBf/XPleFzWYJFZLdO9CEMiv
// SIG // v3/Gf/I3fVo/HPKZeUqRUgCvOA8X9S95gWXZqbVr5MfO
// SIG // 9sp6AG9LMEQkIjzP7QOllo9ZKby2/QThcJ8ySif9Va8v
// SIG // /rbljjO7Yl+a21dA6fHOmWaQjP9qYn/dxUoLkSbiOewZ
// SIG // SnFjnXshbcOco6I8+n99lmqQeKZt0uGc+R38ONiU9Mal
// SIG // CpaGpL2eGq4EQoO4tYCbIjggtSXlZOz39L9+Y1klD3ou
// SIG // OVd2onGqBooPiRa6YacRy5rYDkeagMXQzafQ732D8OE7
// SIG // cQnfXXSYIghh2rBQHm+98eEA3+cxB6STOvdlR3jo+KhI
// SIG // q/fecn5ha293qYHLpwmsObvsxsvYgrRyzR30uIUBHoD7
// SIG // G4kqVDmyW9rIDVWZeodzOwjmmC3qjeAzLhIp9cAvVCch
// SIG // 98isTtoouLGp25ayp0Kiyc8ZQU3ghvkqmqMRZjDTu3Qy
// SIG // S99je/WZii8bxyGvWbWu3EQ8l1Bx16HSxVXjad5XwdHe
// SIG // MMD9zOZN+w2/XU/pnR4ZOC+8z1gFLu8NoFA12u8JJxzV
// SIG // s341Hgi62jbb01+P3nSISRKhggLSMIICOwIBATCB/KGB
// SIG // 1KSB0TCBzjELMAkGA1UEBhMCVVMxEzARBgNVBAgTCldh
// SIG // c2hpbmd0b24xEDAOBgNVBAcTB1JlZG1vbmQxHjAcBgNV
// SIG // BAoTFU1pY3Jvc29mdCBDb3Jwb3JhdGlvbjEpMCcGA1UE
// SIG // CxMgTWljcm9zb2Z0IE9wZXJhdGlvbnMgUHVlcnRvIFJp
// SIG // Y28xJjAkBgNVBAsTHVRoYWxlcyBUU1MgRVNOOjMyQkQt
// SIG // RTNENS0zQjFEMSUwIwYDVQQDExxNaWNyb3NvZnQgVGlt
// SIG // ZS1TdGFtcCBTZXJ2aWNloiMKAQEwBwYFKw4DAhoDFQD7
// SIG // X8I3oEgt5TXIMaj5vpaSkuhCm6CBgzCBgKR+MHwxCzAJ
// SIG // BgNVBAYTAlVTMRMwEQYDVQQIEwpXYXNoaW5ndG9uMRAw
// SIG // DgYDVQQHEwdSZWRtb25kMR4wHAYDVQQKExVNaWNyb3Nv
// SIG // ZnQgQ29ycG9yYXRpb24xJjAkBgNVBAMTHU1pY3Jvc29m
// SIG // dCBUaW1lLVN0YW1wIFBDQSAyMDEwMA0GCSqGSIb3DQEB
// SIG // BQUAAgUA43zSMDAiGA8yMDIwMTIxMDIwNTgyNFoYDzIw
// SIG // MjAxMjExMjA1ODI0WjB3MD0GCisGAQQBhFkKBAExLzAt
// SIG // MAoCBQDjfNIwAgEAMAoCAQACAiNQAgH/MAcCAQACAhL9
// SIG // MAoCBQDjfiOwAgEAMDYGCisGAQQBhFkKBAIxKDAmMAwG
// SIG // CisGAQQBhFkKAwKgCjAIAgEAAgMHoSChCjAIAgEAAgMB
// SIG // hqAwDQYJKoZIhvcNAQEFBQADgYEAFURA/7Yp4BVwc1i8
// SIG // bnGb9FD+9z/uM/btspeUhktb3nqtMg2FvbsLgyp2wh6t
// SIG // 2gVWGwhYoWpXNccxH5sPw2hjMxVc2cpQFkNMD11Hi7SU
// SIG // oCA+AGk7u4r7k8X3g5JOvobCI3ElTjblC6NFJ9ZfAVp/
// SIG // wa4Q5J48EM9jDD47vsYHg6wxggMNMIIDCQIBATCBkzB8
// SIG // MQswCQYDVQQGEwJVUzETMBEGA1UECBMKV2FzaGluZ3Rv
// SIG // bjEQMA4GA1UEBxMHUmVkbW9uZDEeMBwGA1UEChMVTWlj
// SIG // cm9zb2Z0IENvcnBvcmF0aW9uMSYwJAYDVQQDEx1NaWNy
// SIG // b3NvZnQgVGltZS1TdGFtcCBQQ0EgMjAxMAITMwAAAS6o
// SIG // 0hkHk/Rr6AAAAAABLjANBglghkgBZQMEAgEFAKCCAUow
// SIG // GgYJKoZIhvcNAQkDMQ0GCyqGSIb3DQEJEAEEMC8GCSqG
// SIG // SIb3DQEJBDEiBCBEl02us0zWjw56G2w61ECf6EfTu1GS
// SIG // 0aj89mTyt0u7PDCB+gYLKoZIhvcNAQkQAi8xgeowgecw
// SIG // geQwgb0EINr+zc7xiFaKqlU3SRN4r7HabRECHXsmlHoO
// SIG // IWhMgskpMIGYMIGApH4wfDELMAkGA1UEBhMCVVMxEzAR
// SIG // BgNVBAgTCldhc2hpbmd0b24xEDAOBgNVBAcTB1JlZG1v
// SIG // bmQxHjAcBgNVBAoTFU1pY3Jvc29mdCBDb3Jwb3JhdGlv
// SIG // bjEmMCQGA1UEAxMdTWljcm9zb2Z0IFRpbWUtU3RhbXAg
// SIG // UENBIDIwMTACEzMAAAEuqNIZB5P0a+gAAAAAAS4wIgQg
// SIG // dunfEgATyc9iRjSAD8gKnjCNw9Jnb9gmLnOcodQyCWIw
// SIG // DQYJKoZIhvcNAQELBQAEggEATSnOCc05ZGLbVbQDhq/Z
// SIG // yh6YU7JqLZMC4PuTfSAm2KYdd7igjFD8nVQxNflpLqwG
// SIG // 5qJDsL8li+N8PlP0at2IkUsRo8e0fa3UBC0ZnfNoGAvO
// SIG // qO3VcY4FRu7mre0J5YHNzZo/7LDapHwWHJuBJVD47rpX
// SIG // peEkdNlpHCwolrv1wc0cP0eo4MGZR3upKTu7iMpXV78D
// SIG // uNU1r6nooH8br6/iBwaDMxeAaZNcpVVkwTSJEMS7qXla
// SIG // 7hq0hebKr7FLyFa9DafEeftztoVojbn6a2MLh6K7Kj38
// SIG // OOjp6kHXxmNziRtyMXnPp0NAavyJXxCqxeVAgB6EEoPs
// SIG // +1L1TlaDgkymJw==
// SIG // End signature block
