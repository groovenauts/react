/* global chrome */

'use strict';

const ports = {};

const IS_FIREFOX = navigator.userAgent.indexOf('Firefox') >= 0;

chrome.runtime.onConnect.addListener(function(port) {
  console.log('background.js chrome.runtime.onConnect port:', port);
  let tab = null;
  let name = null;
  if (isNumeric(port.name)) {
    tab = port.name;
    name = 'devtools';
    installContentScript(+port.name);
  } else {
    tab = port.sender.tab.id;
    name = 'content-script';
  }

  if (!ports[tab]) {
    ports[tab] = {
      devtools: null,
      'content-script': null,
    };
  }
  ports[tab][name] = port;

  if (ports[tab].devtools && ports[tab]['content-script']) {
    doublePipe(ports[tab].devtools, ports[tab]['content-script']);
  }
});

function isNumeric(str: string): boolean {
  return +str + '' === str;
}

function installContentScript(tabId: number) {
  chrome.tabs.executeScript(
    tabId,
    {file: '/build/contentScript.js'},
    function() {},
  );
}

function doublePipe(one, two) {
  one.onMessage.addListener(lOne);
  function lOne(message) {
    two.postMessage(message);
  }
  two.onMessage.addListener(lTwo);
  function lTwo(message) {
    one.postMessage(message);
  }
  function shutdown() {
    one.onMessage.removeListener(lOne);
    two.onMessage.removeListener(lTwo);
    one.disconnect();
    two.disconnect();
  }
  one.onDisconnect.addListener(shutdown);
  two.onDisconnect.addListener(shutdown);
}

function setIconAndPopup(reactBuildType, tabId) {
  chrome.browserAction.setIcon({
    tabId: tabId,
    path: {
      '16': 'icons/16-' + reactBuildType + '.png',
      '32': 'icons/32-' + reactBuildType + '.png',
      '48': 'icons/48-' + reactBuildType + '.png',
      '128': 'icons/128-' + reactBuildType + '.png',
    },
  });
  chrome.browserAction.setPopup({
    tabId: tabId,
    popup: 'popups/' + reactBuildType + '.html',
  });
}

function isRestrictedBrowserPage(url) {
  return !url || new URL(url).protocol === 'chrome:';
}

function checkAndHandleRestrictedPageIfSo(tab) {
  if (tab && isRestrictedBrowserPage(tab.url)) {
    setIconAndPopup('restricted', tab.id);
  }
}

// update popup page of any existing open tabs, if they are restricted browser pages.
// we can't update for any other types (prod,dev,outdated etc)
// as the content script needs to be injected at document_start itself for those kinds of detection
// TODO: Show a different popup page(to reload current page probably) for old tabs, opened before the extension is installed
if (!IS_FIREFOX) {
  chrome.tabs.query({}, tabs => tabs.forEach(checkAndHandleRestrictedPageIfSo));
  chrome.tabs.onCreated.addListener((tabId, changeInfo, tab) =>
    checkAndHandleRestrictedPageIfSo(tab),
  );
}

// Listen to URL changes on the active tab and update the DevTools icon.
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (IS_FIREFOX) {
    // We don't properly detect protected URLs in Firefox at the moment.
    // However we can reset the DevTools icon to its loading state when the URL changes.
    // It will be updated to the correct icon by the onMessage callback below.
    if (tab.active && changeInfo.status === 'loading') {
      setIconAndPopup('disabled', tabId);
    }
  } else {
    // Don't reset the icon to the loading state for Chrome or Edge.
    // The onUpdated callback fires more frequently for these browsers,
    // often after onMessage has been called.
    checkAndHandleRestrictedPageIfSo(tab);
  }
});

class ReactComponentPool {
  constructor() {
    console.log('background.js ReactComponentPool is created');
    this._map = {};
    this._key = 'default';
  }

  get impl() {
    const k = this._key;
    if (this._map[k] === undefined) {
      this._map[k] = [];
    }
    return this._map[k];
  }

  add(component) {
    const impl = this.impl;
    if (!impl.includes(component)) {
      console.log('background.js ReactComponentPool.add', component);
      impl.push(component);
    }
  }

  setKey(key) {
    this._key = key;
  }

  all() {
    console.log('background.js ReactComponentPool.all');
    const res = {};
    for (const k in this._map) {
      res[k] = (this._map[k] || []).sort();
    }
    return res;
  }
}

const reactComponentPool = new ReactComponentPool();
window.setReactComponentPoolKey = key => reactComponentPool.setKey(key);
window.getReactComponents = () => reactComponentPool.all();

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // console.log('background.js Received from content script:', {request, sender});

  // console.log('background.js Received message from content script:', request);
  // console.log('background.js process.env', process.env);
  // console.log('background.js process.cwd()', process.cwd());

  if (request.setReactComponentPoolKey) {
    reactComponentPool.setKey(request.key);
    return true;
  } else if (request.reactComponent) {
    reactComponentPool.add(request.element.displayName);
    // console.log(
    //   'background.js Received reactComponent message',
    //   request.element.displayName,
    // );
    // localStorage.set(
    //   'reactComponentDisplayNames',
    //   JSON.stringify(reactComponentDisplayNames),
    // );
    return true;
  } else if (request.queryReactComponents) {
    // sendResponse(reactComponentDisplayNames);
    // sendResponse({response: 'バックグラウンドスクリプトからの応答です'});
    // return true;
    // return Promise.resolve({
    //   response: 'バックグラウンドスクリプトからの応答です',
    // });

    // setTimeout(function() {
    sendResponse({namesMap: reactComponentPool.all()});
    // }, 100);
    return true;
  } else {
    const tab = sender.tab;
    if (tab) {
      const id = tab.id;
      // This is sent from the hook content script.
      // It tells us a renderer has attached.
      // console.log('background.js Received from content script:', request);
      if (request.hasDetectedReact) {
        // We use browserAction instead of pageAction because this lets us
        // display a custom default popup when React is *not* detected.
        // It is specified in the manifest.
        setIconAndPopup(request.reactBuildType, id);
        return true;
      } else {
        switch (request.payload?.type) {
          case 'fetch-file-with-cache-complete':
          case 'fetch-file-with-cache-error':
            // Forward the result of fetch-in-page requests back to the extension.
            const devtools = ports[id]?.devtools;
            if (devtools) {
              devtools.postMessage(request);
            }
            break;
        }
        return true;
      }
    }
  }

  return true;
});
