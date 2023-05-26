// Scripts are cached in memory in the background page
var routes = [];
// Map of tabId -> panelUrl
var PARSED_TABS = {};
// Check for updates a maximum of once a minute, when the user navigates
var UPDATE_INTERVAL = 1 * 60 * 1000;
var lastUpdatedAt = 0;
var SCRIPT_LOADED_TABS = {};

// initialize badge;
initializeBadge();
bindBadgeListener();
// Load scripts from the server when the extension first loads
loadScripts();
// TODO FIX ME - not needed
// checkAccountFlags(function (err, shouldRefresh) {
//   if (err) return console.error("Error while checking account flags", err);
//   if (!shouldRefresh) return;
//   reset();
//   chrome.runtime.reload();
// });

// Bind navigation handlers
chrome.webNavigation.onCommitted.addListener(
  onNavigate.bind(null, "onCommitted")
);
chrome.webNavigation.onTabReplaced.addListener(
  onNavigate.bind(null, "onTabReplaced")
);
chrome.webNavigation.onHistoryStateUpdated.addListener(
  onNavigate.bind(null, "onHistoryStateUpdated")
);
chrome.webNavigation.onReferenceFragmentUpdated.addListener(
  onNavigate.bind(null, "onReferenceFragmentUpdated")
);

chrome.webNavigation.onBeforeNavigate.addListener(function (details) {
  // Don't check any more frequently than once every five seconds
  if (details.timeStamp < lastUpdatedAt + UPDATE_INTERVAL) return;
  lastUpdatedAt = details.timeStamp;
  // Load the latest scripts from the server, and reload the navigating
  // tab if they have changed
  // loadScripts(function (err, isUpdated) {
  //   if (!isUpdated) return;
  //   chrome.tabs.reload(details.tabId);
  // });
  //
  // checkAccountFlags(function (err, shouldRefresh) {
  //   if (err) return console.error("Error while checking account flags", err);
  //   if (!shouldRefresh) return;
  //   reset();
  // });
});

chrome.runtime.onMessage.addListener(async function (message, sender, cb) {
  if (!(sender && sender.tab)) return;
  var tabId = sender.tab.id;
  if (!tabId) throw new Error("Expected tabId");
  switch (message.type) {
    // TODO: Change name from setPopup
    case "setPopup":
      if (typeof message.value !== "string") return;
      var parsed = JSON.parse(decodeURIComponent(message.value));
      PARSED_TABS[tabId] = parsed;
      WaitingForParsedData.drain(tabId);
      var profile = parsed.data;
      setAction(profile, tabId);
      return;
    case "toggleToast":
      toggleToast(null, tabId);
      return;
    case "getTabId":
      cb({tabId: tabId});
      return;
    case "getParsedData":
      if (PARSED_TABS[tabId]) {
        cb(PARSED_TABS[tabId]);
      } else {
        // If the parsed data has not been returned by the content script yet,
        // add the callback
        WaitingForParsedData.add(tabId, cb);
      }
      // Returning true tells Chrome that the callback will be called
      // in the future. If true is not returned from this listener,
      // Chrome will close the communication channel between the
      // backround page and the "sender" and the callback will no-op.
      return true;
    case "disableCurrentSite":
      // SiteConf.disableToastForUrl(CURRENT_URLS[tabId]);
      return;
    case "getWcOrigin":
      cb(await getWcOrigin());
      return;
    case "newPanel":
    case "profileReady":
    case "toggleHideDialogue":
    case "togglePanel":
      chrome.tabs.sendMessage(tabId, message);
      return;
    case "log":
      console.log.apply(
          console,
          ["tabId:", tabId, " -> "].concat(message.value)
      );
      return;
  }
});

// WaitingForParsed data is a singleton that is meant to
// simply hold waiting callbacks. This is needed when
// we are trying to respond to the getParsedData event
// from panel.js before our content script has had a chance
// to return the parsed data.
var WaitingForParsedData = (function () {
  var callbacks = {};

  function add(tabId, cb) {
    if (!tabId && cb) return;
    var pending = { cb: cb, timeout: -1 };
    pending.timeout = setTimeout(function () {
      var payload = PARSED_TABS[tabId] || {
        error: "NO_PARSED_DATA",
        currentUrl: CURRENT_URLS[tabId],
      };
      cb(payload);
      var pendingIndex = callbacks[tabId].indexOf(pending);
      if (pendingIndex > -1) callbacks[tabId].splice(pendingIndex, 1);
    }, 15000);
    callbacks[tabId] = callbacks[tabId] || [];
    callbacks[tabId].push(pending);
  }

  function drain(tabId) {
    var pendingCallbacks = callbacks[tabId];
    if (!pendingCallbacks) return;
    pendingCallbacks.forEach(function (pending) {
      pending.cb(PARSED_TABS[tabId]);
      if (pending.timeout) clearTimeout(pending.timeout);
    });
    reset(tabId);
  }

  function reset(tabId) {
    if (!tabId) return;
    callbacks[tabId] = [];
  }

  return {
    add: add,
    drain: drain,
    reset: reset,
    _callbacks: callbacks,
  };
})();

function initializeBadge(tabId) {
  var details = {};
  // if a tabId is provided, run set the badge for this tab
  if (tabId != null) details.tabId = tabId;
  details.path = {
    19: "icons/wc-icon-19.png",
    38: "icons/wc-icon-38.png",
  };
  chrome.action.setIcon(details);
}

function bindBadgeListener() {
  // toggle the side panel whenever the browser action is clicked
  chrome.action.onClicked.addListener(function (e) {
    sendMessageToActiveTab({ type: "togglePanel" });
  });
}

function reset() {
  for (tabId in CURRENT_URLS) {
    chrome.tabs.reload(+tabId);
  }
}

// Update the cache of scripts that get injected on navigation
function setup() {
  routes = [['https://hire.lever.co/candidates/', 'Lever', { jQuery: false }], ['https://hire.sandbox.lever.co/candidates/', 'Lever', { jQuery: false }]]
}

async function loadScripts(cb) {
  setup();
  cb && cb(null, true);
}

// AJAX get request
function request(url, cb) {
  fetch(url)
      .then(response => {
        if(response.status !== 200) {
          return cb({ statusCode: response.status, message: response.statusText });
        } else {
          return response.text()
        }
      })
      .then(response => cb(null, response))
}

// AJAX Response helper
function parseResponse(err, data) {
  if (err) {
    return console.error("Error making request", err);
  } else if (typeof data !== "string") {
    return console.warn("Request got an empty response", data);
  }
  try {
    var parsed = JSON.parse(data);
  } catch (e) {
    return console.error("Error parsing response. Probably logged out.");
  }
  return parsed;
}

// Map of tabId -> url of current tab
var CURRENT_URLS = {};
function onNavigate(eventName, details) {
  // frameId will always be 0 for the root frame and we only care about the events
  // related to the root frame.
  if (details.frameId !== 0 || !details.url) return;
  // Sometimes the history state event will fire soon after the initial page load
  // with the same url (e.g Facebook). We want to ignore this particular case.
  if (
    eventName === "onHistoryStateUpdated" &&
    CURRENT_URLS[details.tabId] === details.url
  ){
    return
  }
  chrome.tabs.sendMessage(details.tabId, { type: "reset" });
  for (var i = 0, len = routes.length; i < len; i++) {
    var route = routes[i];
    if (
      details.transitionType === "auto_subframe" ||
      !details.url.startsWith(route[0])
    ){
      continue;
    }
    if (details.tabId) {
      // Store the current url for the tab
      CURRENT_URLS[details.tabId] = details.url;
      // Delete any of the data we had scraped for this tab
      delete PARSED_TABS[details.tabId];
      // Clear any waiting callbacks
      WaitingForParsedData.reset(details.tabId);
      // reset the badge state for this tab
      initializeBadge(details.tabId);
      // inject the scraping content script for the tab
      if (!SCRIPT_LOADED_TABS[details.tabId]) {
        injectContentScript(details.tabId, route[0], route[1], route[2]);
      }
    }
    break;
  }
}

// Inject applicable cached scripts immediately as the user navigates
function injectContentScript(tabId, url, scriptName, options) {
  chrome.scripting.executeScript({
    target: {tabId: tabId, allFrames: true},
    func: function() {
      var VERSION, wcOrigin, setPopup;

      VERSION = '1.0';
      wcOrigin = 'https://staging.whitecarrot.io';
      setPopup = function(profile) {
        const value = {
          iframeUrl: wcOrigin + '/#/plugin/stages?candidateId=' + profile.candidateId + '&ats=' + profile.ats,
          data: profile
        };
        return chrome.runtime.sendMessage({
          type: 'setPopup',
          value: encodeURIComponent(JSON.stringify(value))
        });
      };

      (function() {
        var leverParser, profile;
        profile = {
          version: VERSION,
          sourceUrl: encodeURIComponent(window.location.href),
          publicProfileUrl: window.location.href
        };
        let previousUrl = '';
        const observer = new MutationObserver(function(mutations) {
          if (location.href !== previousUrl) {
            previousUrl = location.href;
            var e;
            try {
              leverParser();
              return setPopup(profile);
            } catch (error) {
              e = error;
              console.warn('Error parsing Lever', e);
            }
          }
        });
        const config = {subtree: true, childList: true};
        observer.observe(document, config);
        return leverParser = function() {
          profile = {
            version: VERSION,
            sourceUrl: encodeURIComponent(window.location.href),
            publicProfileUrl: window.location.href
          };
          if (window.location.origin.includes('lever.co', 0)) {
            profile.ats = 'lever'
          }

          if (window.location.pathname.startsWith('/candidates/')){
            profile.candidateId = window.location.pathname.replace('/candidates/', '')
          }
          if(profile.candidateId) {
            return profile;
          } else {
            throw Error("Invalid candidate id")
          }
        };
      })();
    },
  });
}

function setAction(extracted, tabId) {
  if (!extracted)
    return console.error("Extracted data not provided to setAction");

  create()

  function create() {
    PARSED_TABS[tabId].action = "create";
    setCreateBadge(tabId);
    toggleToast(tabId);
  }
}

function setCreateBadge(tabId) {
  chrome.action.setTitle({ title: "WhiteCarrot Plugin", tabId: tabId });
}

function toggleToast(action, tabId) {
  if (arguments.length === 1) {
    tabId = action;
    action = PARSED_TABS[tabId].action;
  }
  var message = {
    type: "toggleToast",
    value: action,
    // NOTE: shouldPreload is a temporary flag that controls whether the extension
    // should preload the profile. Implemented incase the additional load of
    // open pages results in degraded app performance.
    shouldPreload: false,
    shouldDisplayToast: true,
  };
  chrome.tabs.sendMessage(tabId, message);
}

function sendMessageToActiveTab(message) {
  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    if (!tabs || !tabs[0]) return;
    chrome.tabs.sendMessage(tabs[0].id, message);
  });
}

async function getWcOrigin() {
  return "https://staging.whitecarrot.io/api"
}
