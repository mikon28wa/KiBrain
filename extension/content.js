"use strict";
(() => {
  // extension/src/lib/detector.ts
  function detectGenericConversations(doc) {
    const conversations2 = [];
    for (const element of doc.querySelectorAll("[data-conversation-id]")) {
      const id = element.getAttribute("data-conversation-id");
      if (!id) continue;
      const titleElement = element.querySelector(".title") ?? element.querySelector("[data-title]");
      const title = (titleElement?.textContent ?? "").trim();
      const messages = [];
      for (const message of element.querySelectorAll("[data-role]")) {
        const role = message.getAttribute("data-role") ?? "user";
        const content = (message.textContent ?? "").trim();
        messages.push({ role, content });
      }
      conversations2.push({ id, title: title || void 0, messages });
    }
    return conversations2;
  }
  var detectors = {
    generic: detectGenericConversations
  };
  function detectConversations(platform, doc) {
    const detector = detectors[platform] ?? detectors.generic;
    return detector(doc);
  }

  // extension/src/content.ts
  function wrapElement(element) {
    return {
      getAttribute: (name) => element.getAttribute(name),
      get textContent() {
        return element.textContent;
      },
      querySelector: (selector) => {
        const result = element.querySelector(selector);
        return result ? wrapElement(result) : null;
      },
      querySelectorAll: (selector) => Array.from(element.querySelectorAll(selector)).map(wrapElement)
    };
  }
  function currentPlatform() {
    const hostname = window.location.hostname.toLowerCase();
    if (hostname.includes("chatgpt.com") || hostname.includes("openai.com")) return "openai";
    if (hostname.includes("claude.ai")) return "anthropic";
    return "generic";
  }
  var root = {
    querySelectorAll: (selector) => Array.from(document.querySelectorAll(selector)).map(wrapElement)
  };
  var conversations = detectConversations(currentPlatform(), root);
  chrome.runtime.sendMessage({ type: "KIBRAIN_DETECT_RESULT", conversations });
})();
