// TODO: Get rid of file-global state
var panelIframe = null;
var oldIframe = null;
var toastIframe = null;
var onProfileReady = null
var isProfileReady = false

function createPanelIframe() {
  if (panelIframe) return;
  panelIframe = document.createElement('iframe');
  panelIframe.src = chrome.runtime.getURL('panel.html');
  panelIframe.className = 'wc-hire-frame';
  document.body.appendChild(panelIframe);
}

function createToastIframe(action) {
  if (toastIframe) return;
  toastIframe = document.createElement('iframe');
  var toastSrc = new URL(chrome.runtime.getURL('toast.html'));
  toastSrc.hash  = action
  toastIframe.src = toastSrc.toString()
  toastIframe.className = `wc-hire-toast-frame ${action}`
  document.body.appendChild(toastIframe);
}

function destroyToast() {
  if (!toastIframe) return;
  toastIframe.parentNode.removeChild(toastIframe);
  toastIframe = null;
}

function destroyPanelIframe() {
  if (!panelIframe) return;
  panelIframe.parentNode.removeChild(panelIframe);
  panelIframe = null;
}

function destroyOldIframe() {
  if (!oldIframe) return;
  oldIframe.parentNode.removeChild(oldIframe);
  oldIframe = null;
}

// TODO: debounce this function so you don't
// get wierd behaviour when clicking on the browser action
// multiple times in succession
function togglePanelIframe () {
  if (isFrameOpen(panelIframe)) {
    slideOut(panelIframe);
  } else {
    createPanelIframe();
    setTimeout(slideIn.bind(null, panelIframe), 0);
    setTimeout(destroyToast, 300);
    setTimeout(destroyOldIframe, 300);
  }
}

function toggleToast (action) {
  if (isFrameOpen(toastIframe) && !action) {
    // The toast is open, we 're trying to close it
    slideOut(toastIframe);
    setTimeout(destroyToast, 300);
  } else if (isFrameOpen(toastIframe) && action) {
    // The toast is open and we're trying to insert a new one
    // destroy the old one first
    destroyToast();
    toggleToast(action);
  } else if (action) {
    // The toast is closed and we slide it in after creating it
    createToastIframe(action);
    setTimeout(slideIn.bind(null, toastIframe), 0);
  }
}

function isFrameOpen(frame) {
  if (frame && frame.classList.contains('open')) return true;
  return false;
}

function slideIn(frame) {
  frame.classList.add('open');
}

function slideOut(frame) {
  frame.classList.remove('open');
}

chrome.runtime.onMessage.addListener(function(message, sender, cb) {
  switch (message.type) {
    case 'togglePanel':
      togglePanelIframe();
      return;
    case 'toggleToast':
      // Never allow the toast to open over the panel
      if (isFrameOpen(panelIframe) && !isFrameOpen(toastIframe)) return;
      // Preload the iframe if we're opening the toast
      // NOTE: the localStorage flag can be set remotely via account.flags
      if (!isFrameOpen(toastIframe) && message.shouldPreload) {
        setTimeout(createPanelIframe, 1000);
      }
      if (message.shouldDisplayToast) toggleToast(message.value);
      return;
    case 'reset':
      destroyPanelIframe();
      destroyToast();
      return;
    case 'toggleHideDialogue':
      toastIframe.classList.add('expanded')
      return;
    case 'newPanel':
      oldIframe = panelIframe
      panelIframe = null;
      createPanelIframe();
      // TODO: use proper event listeners here instead of assigning a global handler
      onProfileReady = function() {
        slideIn(panelIframe);
        setTimeout(destroyOldIframe, 300);
      }
      return;
    case 'profileReady':
      isProfileReady = true
      // TODO: use proper event listeners here instead of calling a global fn
      if (typeof onProfileReady == 'function') {
        onProfileReady();
      }
      return;
  }
});

// Ensure the parent page doesn't scroll when scrolling within the panelIframe
// Is there a better way to do this?
document.body.addEventListener("wheel", onWheel);
function onWheel (e){
  if (panelIframe && e.target === panelIframe) e.preventDefault();
}

// Add a keyboard shortcut that opens the Extension
// TODO: Make this configurable/toggleable
window.addEventListener('keydown', function(e) {
  // meta+shift+l
  if (e && e.keyCode === 76 && e.shiftKey === true && e.metaKey === true) {
    togglePanelIframe()
  }
});
