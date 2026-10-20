import { detectConversations, type DomElement, type DomRoot } from './lib/detector';

declare const chrome: any;

function wrapElement(element: Element): DomElement {
  return {
    getAttribute: (name) => element.getAttribute(name),
    get textContent() {
      return element.textContent;
    },
    querySelector: (selector) => {
      const result = element.querySelector(selector);
      return result ? wrapElement(result) : null;
    },
    querySelectorAll: (selector) => Array.from(element.querySelectorAll(selector)).map(wrapElement),
  };
}

/** Platform is derived from the hostname; more platforms can be added here. */
function currentPlatform(): string {
  const hostname = window.location.hostname.toLowerCase();
  if (hostname.includes('chatgpt.com') || hostname.includes('openai.com')) return 'openai';
  if (hostname.includes('claude.ai')) return 'anthropic';
  return 'generic';
}

// Injected on demand via chrome.scripting.executeScript (this file is no longer
// declared as a content script). Detect conversations and report them back.
const root: DomRoot = {
  querySelectorAll: (selector) => Array.from(document.querySelectorAll(selector)).map(wrapElement),
};
const conversations = detectConversations(currentPlatform(), root);
chrome.runtime.sendMessage({ type: 'KIBRAIN_DETECT_RESULT', conversations });
