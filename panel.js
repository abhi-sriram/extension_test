var iframe = document.getElementsByTagName("iframe")[0];
var iframeUrl;
var hashData = null;
var tabId = null;

window.addEventListener("message", onIframeMessage, false);

chrome.runtime.sendMessage({ type: "getTabId" }, function (info) {
  tabId = info.tabId;
});

// Only send this message once the DOM is loaded, otherwise Chrome
// may cancel the request and leave the user hanging on the loading screen.
window.addEventListener("load", function (e) {
  chrome.runtime.sendMessage({ type: "getParsedData" }, async function (parsed) {
    if (parsed && !parsed.error) {
      iframeUrl = "https://staging.whitecarrot.io/#/plugin/stages?candidateId=" + parsed.data.candidateId;
      hashData = parsed.data;
    } else if (parsed && parsed.error) {
      log("Received parse error", parsed);
      iframeUrl =
          await getDefaultPanelUrl() +
          "?parseError=SCRAPE_FAILED&sourceUrl=" +
          parsed.currentUrl;
      hashData = {error: "SCRAPE_FAILED"};
    } else {
      log("Did not receive any parsed data", parsed);
      iframeUrl = await getDefaultPanelUrl() + "?parseError=SCRAPE_FAILED";
      hashData = {error: "SCRAPE_FAILED"};
    }
    setTimeout(() => {
      iframe.src = iframeUrl;
    }, 300)
  });
});

function sendIframe(message) {
  iframe.contentWindow.postMessage(message, "*");
}
function sendBackground(message) {
  chrome.runtime.sendMessage(message);
}

// TODO: Ensure that event is coming from our own page
function onIframeMessage(e) {
  if (!e.data) return;
  switch (e.data.type) {
    case "getHashData":
      sendIframe({ type: "hashData", value: hashData });
      return;
    case "newPanel":
    case "profileReady":
    case "setBadge":
    case "togglePanel":
      sendBackground(e.data);
      return;
  }
}

async function getDefaultPanelUrl() {
  return "https://staging.whitecarrot.io/#/plugin/default";
}

function log() {
  var args = 1 <= arguments.length ? [].slice.call(arguments, 0) : [];
  sendBackground({ type: "log", value: args });
}
