// Listening to messages from Content Script
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.action === 'CAPTURE_TAB') {
    // Use JPEG for smaller payloads and faster transmission to Gemini
    chrome.tabs.captureVisibleTab(
      chrome.windows.WINDOW_ID_CURRENT, 
      { format: 'jpeg', quality: 75 }, 
      (dataUrl) => {
        sendResponse({ success: true, dataUrl });
      }
    );
    return true;
  }
});
