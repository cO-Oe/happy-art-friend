// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

const { ActivityHandler, ActivityTypes, teamsGetChannelId, ConsoleTranscriptLogger } = require('botbuilder');
const { LuisRecognizer, QnAMaker } = require('botbuilder-ai');
const { maxActionTitleLength } = require('botbuilder-dialogs');
const { BlobServiceClient } = require('@azure/storage-blob');
const ComputerVisionClient = require('@azure/cognitiveservices-computervision').ComputerVisionClient;
const ApiKeyCredentials = require('@azure/ms-rest-js').ApiKeyCredentials;
const CosmosClient = require("@azure/cosmos").CosmosClient;
const axios = require('axios');
const uuid = require('uuid');
const https = require('https')

const CONVERSATION_DATA_PROPERTY = 'conversationData';
const USER_PROFILE_PROPERTY = 'userProfile';

/**
 * A simple bot that responds to utterances with answers from QnA Maker.
 * If an answer is not found for an utterance, the bot responds with help.
 */
class QnABot extends ActivityHandler {
    /**
     *
     * @param {ConversationState} conversationState
     * @param {UserState} userState
     */
    constructor(conversationState, userState) {
        super();
        if (!conversationState) throw new Error('[QnABot]: Missing parameter. conversationState is required');
        if (!userState) throw new Error('[QnABot]: Missing parameter. userState is required');

        // Create the state property accessors for the conversation data and user profile.
        this.conversationDataAccessor = conversationState.createProperty(CONVERSATION_DATA_PROPERTY);
        this.userProfileAccessor = userState.createProperty(USER_PROFILE_PROPERTY);

        this.conversationState = conversationState;
        this.userState = userState;

        // Create computer vision model 
        const computerVisionClient = new ComputerVisionClient(
          new ApiKeyCredentials({ inHeader: { 'Ocp-Apim-Subscription-Key': process.env.CVAPIKey } }), process.env.CVEndpointHostName);

        this.computerVisionClient = computerVisionClient;
    
        const dispatchRecognizer = new LuisRecognizer({
            applicationId: process.env.LuisAppId,
            endpointKey: process.env.LuisAPIKey,
            endpoint: `https://${ process.env.LuisAPIHostName }.api.cognitive.microsoft.com`
        }, {
            includeAllIntents: true,
            includeInstanceData: true
        }, true);

        this.dispatchRecognizer = dispatchRecognizer;

        const qnaMaker = new QnAMaker({
            knowledgeBaseId: process.env.QnAKnowledgebaseId,
            endpointKey: process.env.QnAEndpointKey,
            host: process.env.QnAEndpointHostName
        });

        this.qnaMaker = qnaMaker;

        const cosmosClient = new CosmosClient({ 
          endpoint: process.env.CosmosDbEndpoint, 
          key: process.env.CosmosDbAuthKey 
        });

        const cosmosDatabase = cosmosClient.database("PaintingDB");
        const cosmosContainer = cosmosDatabase.container("paintings");
        this.cosmosContainer = cosmosContainer;



        this.onMessage(async (context, next) => {
            // Get the state properties from the turn context.
            const userProfile = await this.userProfileAccessor.get(context, {});
            const conversationData = await this.conversationDataAccessor.get(context, {});
            if (!userProfile.language){
              userProfile.language = "en"
            }
            // If user input is an attachment
            if (context.activity.attachments && context.activity.attachments.length > 0) {
              // The user sent an attachment and the bot should handle the incoming attachment.
              await this.handleIncomingAttachment(context,userProfile);
            } 
            else {
              function validURL(str) {
                var pattern = new RegExp('^(https?:\\/\\/)?'+ // protocol
                  '((([a-z\\d]([a-z\\d-]*[a-z\\d])*)\\.)+[a-z]{2,}|'+ // domain name
                  '((\\d{1,3}\\.){3}\\d{1,3}))'+ // OR ip (v4) address
                  '(\\:\\d+)?(\\/[-a-z\\d%_.~+]*)*'+ // port and path
                  '(\\?[;&a-z\\d%_.~+=-]*)?'+ // query string
                  '(\\#[-a-z\\d_]*)?$','i'); // fragment locator
                return !!pattern.test(str);
              }

              if (validURL(context.activity.text)) {
                await this.handleIncomingURL(context,userProfile);
              }
              else {
                // First, we use the dispatch model to determine which cognitive service (LUIS or QnA) to use.
                context.activity.text = await this.otherToEnglish(context.activity.text,userProfile);

                //console.log(`${context.activity.text}`)
                //console.log(JSON.stringify(context, null, 4))
                const recognizerResult = await dispatchRecognizer.recognize(context);
                // Top intent tell us which cognitive service to use.
                const intent = LuisRecognizer.topIntent(recognizerResult);

                // Next, we call the dispatcher with the top intent.
                //await this.dispatchToTopIntentAsync(context, intent, recognizerResult);
                switch (intent) {
                  case 'art_luis':
                      console.log('sent to art luis')
                      if(!userProfile.paintingID) {
                        await context.sendActivity('Send me a URL first before you ask for the details!');
                        await context.sendActivity('You may upload your photo through this website: https://img.onl/');
                      }
                      else {
                          const luisReply = await this.ProcessArtLuis(context, recognizerResult.luisResult,userProfile);
                          if (userProfile.language!="en"){
                            const reply = await this.englishToOther(luisReply,userProfile);
                            console.log(`${reply}`)
                            await context.sendActivity(reply);
                          }
                          else{
                            await context.sendActivity(luisReply);
                          }
                      }
                      break;
                  case 'art_qna':
                      console.log('sent to art QnA')
                      //userProfile.paintingID = context.activity.text;
                      await this.processArtQnA(context,userProfile);
                      break;
                  default:
                      console.log(`Dispatch unrecognized intent: ${ intent }.`);
                      await context.sendActivity(`Dispatch unrecognized intent: ${ intent }.`);
                      break;
                }
              }
              
            } 
            // By calling next() you ensure that the next BotHandler is run.
            await next();
        });

        // If a new user is added to the conversation, send them a greeting message
        this.onMembersAdded(async (context, next) => {
            const membersAdded = context.activity.membersAdded;
            for (let cnt = 0; cnt < membersAdded.length; cnt++) {
                if (membersAdded[cnt].id !== context.activity.recipient.id) {
                    await context.sendActivity('Hello world! I am ART-ificial Intellegent Chatbot!');
                    await context.sendActivity('I love everything about ART!!! You can ask me any question!');
                    await context.sendActivity('Send me a URL of real world photo and I\'ll find the most-related masterpiece for you!');
                    await context.sendActivity('You may upload your photo through this website: https://img.onl/');
                }
            }

            // By calling next() you ensure that the next BotHandler is run.
            await next();
        });
    }

    async ProcessArtLuis(context, luisResult,userProfile) {
        console.log('ProcessArtLuis');
        // Retrieve LUIS result for Process Automation.
        const result = luisResult.connectedServiceResult;
        const intent = result.topScoringIntent.intent;
        //await context.sendActivity(`Art_Luis top intent ${ intent }.`);
        switch (intent) {
          case 'paintingAuthor':
              //await context.sendActivity(`Author of the painting is ${ userProfile.paintingAuthor }.`);
              const reply1 = `Author of the painting is ${ userProfile.paintingAuthor }.`;
              return reply1;
              break;
          case 'paintingDate':
              //await context.sendActivity(`Date of the painting is ${ userProfile.paintingYear }.`);
              const reply2 = `Year of the painting is ${ userProfile.paintingYear }.`;
              return reply2;
              break;
          case 'paintingName':
              //await context.sendActivity(`Name of the painting is ${ userProfile.paintingTitle }.`);
              const reply3 = `Name of the painting is ${ userProfile.paintingTitle }.`;
              return reply3;
              break;
          case 'paintingStyle':
              //await context.sendActivity(`Style of the painting is ${ userProfile.paintingStyle }.`);
              const reply4 = `Style of the painting is ${ userProfile.paintingStyle }.`;
              return reply4;
              break;
          case 'paintingTechnique':
              //await context.sendActivity(`Technique of the painting is ${ userProfile.paintingTechnique}.`);
              const reply5 = `Technique of the painting is ${ userProfile.paintingTechnique}.`;
              return reply5;
              break;
          default:
              //await context.sendActivity(`Sorry, I didn't get that.`);
              const reply6 = "Sorry, I didn't get that.";
              return reply6;
              break;
        }
    }

    async processArtQnA(context,userProfile) {
        console.log('Art_QnA');
    
        const results = await this.qnaMaker.getAnswers(context);
        if (results.length > 0) {
          let firstLine = results[0].answer.split('\n')[0];

          if (firstLine.substring(0, 8) === "![Image]") {
            let restString = results[0].answer.substring(results[0].answer.indexOf('\n')+1)

            const reply = { type: ActivityTypes.Message };

            reply.attachments = [this.getInternetAttachment(firstLine.substring(9, firstLine.indexOf(')')))];
            
            const replyString = await this.englishToOther(restString,userProfile);
            
            await context.sendActivity(reply);
            await context.sendActivity(replyString);
          }
          else {
            const reply = await this.englishToOther(results[0].answer,userProfile);
            await context.sendActivity(reply);
          }
        } else {
            const query = process.argv[2] || context.activity.text
            const reply = await this.bingWebSearch(query)

            await context.sendActivity(`Sorry, I don't know ${context.activity.text}, but I searched it for you!`)

            for ( let i = 0; i < 3; i++ ) {
              await context.sendActivity(reply.value[i].name + '\n' + reply.value[i].url)
            }
        }
    }

    bingWebSearch(query) {
      return new Promise((resolve, reject) => {
        var req = https.get({
          hostname: 'api.bing.microsoft.com',
          path:     '/v7.0/search?q=' + encodeURIComponent(query),
          headers:  { 'Ocp-Apim-Subscription-Key': process.env.SearchKey },
        }, res => {
          let body = ''
          res.on('data', part => body += part)
          res.on('end', () => {
            try {
              resolve(JSON.parse(body).webPages)
            }
            catch (err) {
              reject(err.message)
            }
            // console.dir(JSON.parse(body).webPages, { colors: false, depth: null })
          })
        })
        req.on('error', e => {
          console.log('Error: ' + e.message)
          reject(e.message)
        })
        req.end()
      });
    }

    async otherToEnglish(text,userProfile){
      const typeRes = await axios({
        baseURL: process.env.TranslatorEndpoint,
        url: '/detect',
        method: 'post',
        headers: {
          'Ocp-Apim-Subscription-Key': process.env.TranslatorKey,
          'Ocp-Apim-Subscription-Region': process.env.TranslatorLocation,
          'Content-type': 'application/json',
          'X-ClientTraceId': uuid.v4().toString()
        },
        params: {
          'api-version': '3.0',
        },
        data: [{
          'text': `${text}`
        }],
        responseType: 'json'
      })
      var languageType = JSON.stringify(typeRes.data[0].language, null, 4); 
      
      if (languageType != "en"){

        userProfile.language=languageType
        languageType = languageType.slice(1,-1)

        const tranRes = await axios({
          baseURL: process.env.TranslatorEndpoint,
          url: '/translate',
          method: 'post',
          headers: {
            'Ocp-Apim-Subscription-Key': process.env.TranslatorKey,
            'Ocp-Apim-Subscription-Region': process.env.TranslatorLocation,
            'Content-type': 'application/json',
            'X-ClientTraceId': uuid.v4().toString()
          },
          params: {
            'api-version': '3.0',
            'from': `${languageType}`,
            'to': ['en']
          },
          data: [{
            'text': `${text}`
          }],
          responseType: 'json'
        })
    
        var resultText = JSON.stringify(tranRes.data[0].translations[0].text, null, 4);
        resultText = resultText.slice(1,-1)
        console.log(`${resultText}`)

        return resultText
      }
      else{
        userProfile.language="en"
        return text
      }
    }

    async englishToOther(text,userProfile){
      //const target = userProfile.language
      var target = userProfile.language;
      if (target == "en"){
        return text;
      }
      target = target.slice(1,-1)

      const tranRes = await axios({
        baseURL: process.env.TranslatorEndpoint,
        url: '/translate',
        method: 'post',
        headers: {
          'Ocp-Apim-Subscription-Key': process.env.TranslatorKey,
          'Ocp-Apim-Subscription-Region': process.env.TranslatorLocation,
          'Content-type': 'application/json',
          'X-ClientTraceId': uuid.v4().toString()
        },
        params: {
          'api-version': '3.0',
          'from': "en",
          'to': target
        },
        data: [{
          'text': `${text}`
        }],
        responseType: 'json'
      })
    
      var resultText = JSON.stringify(tranRes.data[0].translations[0].text, null, 4);
      resultText = resultText.slice(1,-1)

      return resultText
    }
    
    async handleIncomingURL(turnContext,userProfile) {
      let tags = await(this.computerVision(turnContext.activity.text));

      let paintNum = 33;
      let maxTag = 0;
      let maxId = 1;

      let queryString = "SELECT VALUE COUNT(1) FROM (SELECT * from c WHERE c.paintid = @n) as d WHERE ";
      for ( let i = 0; i < tags.length; i++ ) {
        queryString += `d.tag = \"${tags[i].name}\"`;
        if ( i != tags.length - 1 )
          queryString += " OR "; 
      }

      for ( let i = 1; i < paintNum; i++ ) {
        // query to return all items
        const querySpec = {
          query: queryString,
          parameters: [
            {
              name: "@n",
              value: i.toString()
            }
          ]
        };

        const { resources: items } = await this.cosmosContainer.items
          .query(querySpec)
          .fetchAll();
        
        if ( items[0] > maxTag ) {
          maxId = i.toString();
          maxTag = items[0];
        }
      }
      
      const querySpec = {
        query: "SELECT * FROM c WHERE c.paintid = @n",
        parameters: [
          {
            name: "@n",
            value: maxId.toString()
          },
        ]
      };

      const { resources: items } = await this.cosmosContainer.items
        .query(querySpec)
        .fetchAll();

      const replyPaint = { type: ActivityTypes.Message };
      const replyPhoto = { type: ActivityTypes.Message };

      
      userProfile.paintingID = items[0].paintid;
      userProfile.paintingTitle = items[0].title;
      userProfile.paintingAuthor = items[0].author;
      userProfile.paintingYear = items[0].year;
      userProfile.paintingStyle = items[0].style;
      userProfile.paintingTechnique = items[0].technique;

      replyPaint.attachments = [this.getInternetAttachment(items[0].url)];
      replyPhoto.attachments = [this.getInternetAttachment(turnContext.activity.text)];
      if(userProfile.language=="en"){

        let tagString = "Hmm... I see these features in your photo: "
        for ( let i = 0; i < tags.length; i++ ) {
          tagString += `"${tags[i].name}"`
          if (i != tags.length - 1)
            tagString += ", ";  
        }

        await turnContext.sendActivity("I received your photo!")
        await turnContext.sendActivity(replyPhoto);
        await turnContext.sendActivity(tagString);
        await turnContext.sendActivity("Aha! I got you your masterpiece!")
        await turnContext.sendActivity(replyPaint);
        await turnContext.sendActivity("You can ask me for more details such as author, date, and so on ...")
      }
      else{

        let tagString = await this.englishToOther("Hmm... I see these characteristics in your photo: ",userProfile);
        for ( let i = 0; i < tags.length; i++ ) {
          tagString += `"${tags[i].name}"`
          if (i != tags.length - 1)
            tagString += ", ";  
        }
        const reply1 = await this.englishToOther("I received your photo!",userProfile);
        const reply2 = await this.englishToOther("Aha! I found your painting!",userProfile);
        const reply3 = await this.englishToOther("You can ask me for more details such as author, date, and so on ...",userProfile);

        await turnContext.sendActivity(reply1);
        await turnContext.sendActivity(replyPhoto);
        await turnContext.sendActivity(tagString);
        await turnContext.sendActivity(reply2);
        await turnContext.sendActivity(replyPaint);
        await turnContext.sendActivity(reply3);
      }
    }

    /**
     * Saves incoming attachments to disk by calling `this.downloadAttachmentAndWrite()` and
     * responds to the user with information about the saved attachment or an error.
     * @param {Object} turnContext
     */
    async handleIncomingAttachment(turnContext,userProfile) {
      // Prepare Promises to download each attachment and then execute each Promise.
      const promises = turnContext.activity.attachments.map(this.writeAttachmentToBlob);
      const successfulSaves = await Promise.all(promises);
      
      async function replyForBlobAttachments(blobAttachmentData) {
        if (blobAttachmentData) {
            // Because the TurnContext was bound to this function, the bot can call
            // `TurnContext.sendActivity` via `this.sendActivity`;
            await this.sendActivity(`Attachment "${ blobAttachmentData.fileName }" ` +
                `has been received and saved to "${ blobAttachmentData.urlPath }".`);
        } else {
            await this.sendActivity('Attachment was not successfully saved to blob.');
        }
      }

      // Prepare Promises to reply to the user with information about saved attachments.
      // The current TurnContext is bound so `replyForReceivedAttachments` can also send replies.
      // const replyPromises = successfulSaves.map(replyForBlobAttachments.bind(turnContext));

      let tags = await(this.computerVision(successfulSaves[0].urlPath));

      let paintNum = 33;
      let maxTag = 0;
      let maxId = 1;

      let queryString = "SELECT VALUE COUNT(1) FROM (SELECT * from c WHERE c.paintid = @n) as d WHERE ";
      for ( let i = 0; i < tags.length; i++ ) {
        queryString += `d.tag = \"${tags[i].name}\"`;
        if ( i != tags.length - 1 )
          queryString += " OR "; 
      }

      for ( let i = 1; i < paintNum; i++ ) {
        // query to return all items
        const querySpec = {
          query: queryString,
          parameters: [
            {
              name: "@n",
              value: i.toString()
            }
          ]
        };

        const { resources: items } = await this.cosmosContainer.items
          .query(querySpec)
          .fetchAll();
        
        if ( items[0] > maxTag ) {
          maxId = i.toString();
          maxTag = items[0];
        }
      }
      
      const querySpec = {
        query: "SELECT * FROM c WHERE c.paintid = @n",
        parameters: [
          {
            name: "@n",
            value: maxId.toString()
          },
        ]
      };

      const { resources: items } = await this.cosmosContainer.items
        .query(querySpec)
        .fetchAll();

      const replyPaint = { type: ActivityTypes.Message };
      const replyPhoto = { type: ActivityTypes.Message };

      
      userProfile.paintingID = items[0].paintid;
      userProfile.paintingTitle = items[0].title;
      userProfile.paintingAuthor = items[0].author;
      userProfile.paintingYear = items[0].year;
      userProfile.paintingStyle = items[0].style;
      userProfile.paintingTechnique = items[0].technique;

      replyPaint.attachments = [this.getInternetAttachment(items[0].url)];
      replyPhoto.attachments = [this.getInternetAttachment(turnContext.activity.text)];

      if(userProfile.language=="en"){

        let tagString = "Hmm... I see these features in your photo: "
        for ( let i = 0; i < tags.length; i++ ) {
          tagString += `"${tags[i].name}"`
          if (i != tags.length - 1)
            tagString += ", ";  
        }

        await turnContext.sendActivity("I received your photo!")
        await turnContext.sendActivity(tagString);
        await turnContext.sendActivity("Aha! I got you your masterpiece!")
        await turnContext.sendActivity(replyPaint);
        await turnContext.sendActivity("You can ask me for more details such as author, date, and so on ...")
      }
      else{

        let tagString = "Hmm... I see these characteristics in your photo: "
        for ( let i = 0; i < tags.length; i++ ) {
          tagString += `"${tags[i].name}"`
          if (i != tags.length - 1)
            tagString += ", ";  
        }
        tagString = await this.englishToOther(tagString,userProfile);

        const reply1 = await this.englishToOther("I received your photo!",userProfile);
        const reply2 = await this.englishToOther("Aha! I found your painting!",userProfile);
        const reply3 = await this.englishToOther("You can ask me for more details such as author, date, and so on ...",userProfile);

        await turnContext.sendActivity(reply1);
        await turnContext.sendActivity(tagString);
        await turnContext.sendActivity(reply2);
        await turnContext.sendActivity(replyPaint);
        await turnContext.sendActivity(reply3);
      }
  }

/**
   * Returns an attachment to be sent to the user from a HTTPS URL.
   */
  getInternetAttachment(url) {
    // NOTE: The contentUrl must be HTTPS.
    return {
        contentType: 'image/jpg',
        contentUrl: url
    };
  }

 /**
  * Downloads attachment to the blob.
  * @param {Object} attachment
  */
  async writeAttachmentToBlob(attachment) {
    // Retrieve the attachment via the attachment's contentUrl.
    const url = attachment.contentUrl;

    // File name to save to the blob
    const blobName = "paintings" + uuid.v1() + ".jpg";

    // Create the BlobServiceClient object which will be used to create a container client
    const blobServiceClient = BlobServiceClient.fromConnectionString(process.env.AZURE_STORAGE_CONNECTION_STRING);
    const containerName = 'paintings';
    // Get a reference to a container
    const containerClient = blobServiceClient.getContainerClient(containerName);

    try {
        // arraybuffer is necessary for images
        const response = await axios.get(url, { responseType: 'arraybuffer' });
        // If user uploads JSON file, this prevents it from being written as "{"type":"Buffer","data":[123,13,10,32,32,34,108..."
        if (response.headers['content-type'] === 'application/json') {
            response.data = JSON.parse(response.data, (key, value) => {
                return value && value.type === 'Buffer' ? Buffer.from(value.data) : value;
            });
        }

        // Get a block blob client
        const blockBlobClient = containerClient.getBlockBlobClient(blobName);

        // Upload data to the blob
        const uploadBlobResponse = await blockBlobClient.upload(response.data, response.data.length);
        console.log("Blob was uploaded successfully. requestId: ", uploadBlobResponse.requestId);
    } catch (error) {
        console.error(error);
        return undefined;
    }
    // If no error was thrown while writing to blob, return the attachment's name
    // and url to the file for the response back to the user.
    return {
        fileName: blobName,
        urlPath: "https://artbotstore.blob.core.windows.net/paintings/" + blobName
    };
  }

  async computerVision (url) {
    try {
      const tagsURL = url;

      function formatTags(tags) {
        return tags.map(tag => (`${tag.name} (${tag.confidence.toFixed(2)})`)).join(', ');
      };

      const tags = (await this.computerVisionClient.analyzeImage(tagsURL, { visualFeatures: ['Tags'] })).tags;
      console.log(`Tags: ${formatTags(tags)}`);
      return tags;
    }
    catch (err) {
      console.log(err);
      return undefined;
    }
  } 

  async run(context) {
        await super.run(context);

        // Save any state changes. The load happened during the execution of the Dialog.
        await this.conversationState.saveChanges(context, false);
        await this.userState.saveChanges(context, false);
    }
}
/**
     * Override the ActivityHandler.run() method to save state changes after the bot logic completes.
     */
    
module.exports.QnABot = QnABot;

// SIG // Begin signature block
// SIG // MIInNgYJKoZIhvcNAQcCoIInJzCCJyMCAQExDzANBglg
// SIG // hkgBZQMEAgEFADB3BgorBgEEAYI3AgEEoGkwZzAyBgor
// SIG // BgEEAYI3AgEeMCQCAQEEEBDgyQbOONQRoqMAEEvTUJAC
// SIG // AQACAQACAQACAQACAQAwMTANBglghkgBZQMEAgEFAAQg
// SIG // +Ag3cy+1AW57JO3pr2f1YPIb1HaHrI+MrsM/jdeB7aKg
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
// SIG // BgorBgEEAYI3AgEVMC8GCSqGSIb3DQEJBDEiBCBThR+/
// SIG // lPMPnuzeF86ruwEV60OGJw4nCbgMr1lrXptdizBCBgor
// SIG // BgEEAYI3AgEMMTQwMqAUgBIATQBpAGMAcgBvAHMAbwBm
// SIG // AHShGoAYaHR0cDovL3d3dy5taWNyb3NvZnQuY29tMA0G
// SIG // CSqGSIb3DQEBAQUABIIBAGdr8/b/OP3vzEYBzmsW8jeG
// SIG // p2lsM8EAqINCod/QHYMWTT9wlH/TxMiMUQsnMzvLj9lm
// SIG // ZMNndL2G+z2UVjnPbnk8iVrlqlbu8MYqnTQ+laJXeMBn
// SIG // X+DdWiFUZnWp9F9YG7/bddPa2OJPr7XrBw5SUn+cAijA
// SIG // 9r8rVAsZXKp8qu1IrM2SHCoxfVt9r6tv2lRqjrADw6HJ
// SIG // a0fjIcLlGboWrHybUtbwwOlz6w2lDbHnvPKTzua+piov
// SIG // IH4Nuw72sEr7EaVvf/nJA1xEg6B1hszqDOlhHwj5zcOk
// SIG // aMHggy4i1Iza8M1PP0QcxcPmKGTNsRJBgdklpjq1iIMX
// SIG // 5p7eV06DAvyhghLxMIIS7QYKKwYBBAGCNwMDATGCEt0w
// SIG // ghLZBgkqhkiG9w0BBwKgghLKMIISxgIBAzEPMA0GCWCG
// SIG // SAFlAwQCAQUAMIIBVQYLKoZIhvcNAQkQAQSgggFEBIIB
// SIG // QDCCATwCAQEGCisGAQQBhFkKAwEwMTANBglghkgBZQME
// SIG // AgEFAAQgnl34tzecEryUP+Y3RdSbQKRLCNqDudczA7vy
// SIG // aIJVZ3cCBl+7z2k9kxgTMjAyMDEyMTAxODU0MjkuNjA5
// SIG // WjAEgAIB9KCB1KSB0TCBzjELMAkGA1UEBhMCVVMxEzAR
// SIG // BgNVBAgTCldhc2hpbmd0b24xEDAOBgNVBAcTB1JlZG1v
// SIG // bmQxHjAcBgNVBAoTFU1pY3Jvc29mdCBDb3Jwb3JhdGlv
// SIG // bjEpMCcGA1UECxMgTWljcm9zb2Z0IE9wZXJhdGlvbnMg
// SIG // UHVlcnRvIFJpY28xJjAkBgNVBAsTHVRoYWxlcyBUU1Mg
// SIG // RVNOOkY3QTYtRTI1MS0xNTBBMSUwIwYDVQQDExxNaWNy
// SIG // b3NvZnQgVGltZS1TdGFtcCBTZXJ2aWNloIIORDCCBPUw
// SIG // ggPdoAMCAQICEzMAAAEli96LbHImMd0AAAAAASUwDQYJ
// SIG // KoZIhvcNAQELBQAwfDELMAkGA1UEBhMCVVMxEzARBgNV
// SIG // BAgTCldhc2hpbmd0b24xEDAOBgNVBAcTB1JlZG1vbmQx
// SIG // HjAcBgNVBAoTFU1pY3Jvc29mdCBDb3Jwb3JhdGlvbjEm
// SIG // MCQGA1UEAxMdTWljcm9zb2Z0IFRpbWUtU3RhbXAgUENB
// SIG // IDIwMTAwHhcNMTkxMjE5MDExNDU4WhcNMjEwMzE3MDEx
// SIG // NDU4WjCBzjELMAkGA1UEBhMCVVMxEzARBgNVBAgTCldh
// SIG // c2hpbmd0b24xEDAOBgNVBAcTB1JlZG1vbmQxHjAcBgNV
// SIG // BAoTFU1pY3Jvc29mdCBDb3Jwb3JhdGlvbjEpMCcGA1UE
// SIG // CxMgTWljcm9zb2Z0IE9wZXJhdGlvbnMgUHVlcnRvIFJp
// SIG // Y28xJjAkBgNVBAsTHVRoYWxlcyBUU1MgRVNOOkY3QTYt
// SIG // RTI1MS0xNTBBMSUwIwYDVQQDExxNaWNyb3NvZnQgVGlt
// SIG // ZS1TdGFtcCBTZXJ2aWNlMIIBIjANBgkqhkiG9w0BAQEF
// SIG // AAOCAQ8AMIIBCgKCAQEA0HsfY3ZgW+zhycEmJjFKK2Tc
// SIG // AHL/Fct+k5Sbs3FcexvpRards41jjJUjjJJtV6ALifFW
// SIG // eUoQXnQA1wxgysRzWYS7txFvMeaLfyDpOosy05QBbbyF
// SIG // zoM17Px2jjO9lxyspDGRwHS/36WbQEjOT2pZrF1+DpfJ
// SIG // V5JvY0eeSuegu6vfoQ1PtrYxh2hNWVpWm5TVFwYWmYLQ
// SIG // iQnetFMmb4CO/7jc3Gn49P1cNm2orfZwwFXduMrf1wmZ
// SIG // x2N8l+2bB4yLh6bJfj6Q12otQ8HvadK8gmbJfUjjB3sb
// SIG // SB3vapU27VmCfFrVi6B/XRDEMVS55jzwzlZgY+y2YUo4
// SIG // t/DfVac/xQIDAQABo4IBGzCCARcwHQYDVR0OBBYEFPOq
// SIG // yuUHJvkBOTQVxgjyIggXQyT4MB8GA1UdIwQYMBaAFNVj
// SIG // OlyKMZDzQ3t8RhvFM2hahW1VMFYGA1UdHwRPME0wS6BJ
// SIG // oEeGRWh0dHA6Ly9jcmwubWljcm9zb2Z0LmNvbS9wa2kv
// SIG // Y3JsL3Byb2R1Y3RzL01pY1RpbVN0YVBDQV8yMDEwLTA3
// SIG // LTAxLmNybDBaBggrBgEFBQcBAQROMEwwSgYIKwYBBQUH
// SIG // MAKGPmh0dHA6Ly93d3cubWljcm9zb2Z0LmNvbS9wa2kv
// SIG // Y2VydHMvTWljVGltU3RhUENBXzIwMTAtMDctMDEuY3J0
// SIG // MAwGA1UdEwEB/wQCMAAwEwYDVR0lBAwwCgYIKwYBBQUH
// SIG // AwgwDQYJKoZIhvcNAQELBQADggEBAJMcWTxhICIAIbKm
// SIG // TU2ZOfFdb0IieY2tsR5eU6hgOh8I+UoqC4NxUi4k5hlf
// SIG // gbRZaWFLZJ3geI62bLjaTLX20zHRu6f8QMiFbcL15016
// SIG // ipQg9U/S3K/eKVXncxxicy9U2DUMmSQaLgn85IJM3HDr
// SIG // hTn3lj35zE4iOVAVuTnZqMhz0Fg0hh6G6FtXUyql3ibb
// SIG // lQ02Gx0yrOM43wgTBY5spUbudmaYs/vTAXkY+IgHqLtB
// SIG // f98byM3qaCCoFFgmfZplYlhJFcArUxm1fHiu9ynhBNLX
// SIG // zFP2GNlJqBj3PGMG7qwxH3pXoC1vmB5H63BgBpX7Qpqr
// SIG // TnTi3oIS6BtFG8fwe7EwggZxMIIEWaADAgECAgphCYEq
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
// SIG // Y28xJjAkBgNVBAsTHVRoYWxlcyBUU1MgRVNOOkY3QTYt
// SIG // RTI1MS0xNTBBMSUwIwYDVQQDExxNaWNyb3NvZnQgVGlt
// SIG // ZS1TdGFtcCBTZXJ2aWNloiMKAQEwBwYFKw4DAhoDFQBF
// SIG // 0y/hUG3NhvtzF17yESla9qFwp6CBgzCBgKR+MHwxCzAJ
// SIG // BgNVBAYTAlVTMRMwEQYDVQQIEwpXYXNoaW5ndG9uMRAw
// SIG // DgYDVQQHEwdSZWRtb25kMR4wHAYDVQQKExVNaWNyb3Nv
// SIG // ZnQgQ29ycG9yYXRpb24xJjAkBgNVBAMTHU1pY3Jvc29m
// SIG // dCBUaW1lLVN0YW1wIFBDQSAyMDEwMA0GCSqGSIb3DQEB
// SIG // BQUAAgUA43y2NDAiGA8yMDIwMTIxMDE4NTkwMFoYDzIw
// SIG // MjAxMjExMTg1OTAwWjB3MD0GCisGAQQBhFkKBAExLzAt
// SIG // MAoCBQDjfLY0AgEAMAoCAQACAheJAgH/MAcCAQACAhHw
// SIG // MAoCBQDjfge0AgEAMDYGCisGAQQBhFkKBAIxKDAmMAwG
// SIG // CisGAQQBhFkKAwKgCjAIAgEAAgMHoSChCjAIAgEAAgMB
// SIG // hqAwDQYJKoZIhvcNAQEFBQADgYEASBVSZJhuYd1ZOxCn
// SIG // tolQ+K6EL79UPthw3MNNhzQZfsUsUxnaY2TsyQut2NEm
// SIG // NUfhKweFwlmULuYC/HRw+QNRUU54kdqNCmY/0u55Rklq
// SIG // s4I4sZpqawLZ/MoLhnQK0hMlrimoCWUYNQvTyMuZ0LHG
// SIG // M0iV8Lo5K5rSr7FpFUKI7csxggMNMIIDCQIBATCBkzB8
// SIG // MQswCQYDVQQGEwJVUzETMBEGA1UECBMKV2FzaGluZ3Rv
// SIG // bjEQMA4GA1UEBxMHUmVkbW9uZDEeMBwGA1UEChMVTWlj
// SIG // cm9zb2Z0IENvcnBvcmF0aW9uMSYwJAYDVQQDEx1NaWNy
// SIG // b3NvZnQgVGltZS1TdGFtcCBQQ0EgMjAxMAITMwAAASWL
// SIG // 3otsciYx3QAAAAABJTANBglghkgBZQMEAgEFAKCCAUow
// SIG // GgYJKoZIhvcNAQkDMQ0GCyqGSIb3DQEJEAEEMC8GCSqG
// SIG // SIb3DQEJBDEiBCCiP4pjmc4ZwO6K1Vi3vwqgDfPgMKi+
// SIG // 4vKXr77hFUzEXTCB+gYLKoZIhvcNAQkQAi8xgeowgecw
// SIG // geQwgb0EIF3fxrIubzBf+ol9gg4flX5i+Ub6mhZBcJbo
// SIG // so3vQfcOMIGYMIGApH4wfDELMAkGA1UEBhMCVVMxEzAR
// SIG // BgNVBAgTCldhc2hpbmd0b24xEDAOBgNVBAcTB1JlZG1v
// SIG // bmQxHjAcBgNVBAoTFU1pY3Jvc29mdCBDb3Jwb3JhdGlv
// SIG // bjEmMCQGA1UEAxMdTWljcm9zb2Z0IFRpbWUtU3RhbXAg
// SIG // UENBIDIwMTACEzMAAAEli96LbHImMd0AAAAAASUwIgQg
// SIG // JMKgXw0mJqtrMje4JzalcyzUs8o9PWrfDq54LIfX2Vow
// SIG // DQYJKoZIhvcNAQELBQAEggEAeuuvK5vakfGlxmILOs9T
// SIG // atI5Fv/kuo30PdRAwe93Ow8/XvlrDSwFGSGnXv6ZBG06
// SIG // vbWEHGyEZISxBKsuiBiqhsl770Hg4GZyM4fLjKXMZ6Q+
// SIG // hzCUEOWjDYZCh1zwC9Xx5oFB/r887d7+Zp5tV2dE4E8m
// SIG // VBiwu+H9VR/S8j/E2TofKDes850JvRrWRea17FZvzG+t
// SIG // VtZXTBl0IcKPeSWRSgTqP4CYu0iY1SH+JYmRrST18CG2
// SIG // KWe/H3b1lG9QjHuG9dYimb9/IchVaqSd+kliWXJvjOew
// SIG // kEaVgtX8h3vywzqRYNRfPe0BSPCzJEb8Htg6PiquTjS4
// SIG // JfVJ4b13zKGq8A==
// SIG // End signature block
