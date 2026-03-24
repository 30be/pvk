import { encryptMessage, decryptMessage, generateKeyPair, getPublicKeyFromPrivate, normalizeArmored } from "./crypto";
import { getPrivateKey, setPrivateKey, getRecipientKey, setRecipientKey, getConvoIdFromUrl } from "./storage";

const PGP_HEADER = "-----BEGIN PGP MESSAGE-----";
const PGP_FOOTER = "-----END PGP MESSAGE-----";
const PVK_KEY_PREFIX = "PVK_KEY:";
const DECRYPTED_ATTR = "data-pvk-decrypted";
const KEY_HANDLED_ATTR = "data-pvk-key-handled";
const LOCK_ICON = "\u{1F512}";
const KEY_ICON = "\u{1F511}";

let pvkTextarea: HTMLTextAreaElement | null = null;
let pvkSendBtn: HTMLButtonElement | null = null;
let pvkGenerateBtn: HTMLButtonElement | null = null;
let pvkStandaloneShareBtn: HTMLButtonElement | null = null;
let isActive = false;

// --- Send button coloring ---

function getSendButton(): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    ".ConvoComposer__sendButton--submit"
  );
}

function colorSendButton(active: boolean) {
  const btn = getSendButton();
  if (!btn) return;
  if (active) {
    btn.style.setProperty("background-color", "#4CAF50", "important");
    btn.style.setProperty("border-color", "#4CAF50", "important");
  } else {
    btn.style.removeProperty("background-color");
    btn.style.removeProperty("border-color");
  }
}

// --- Input hijack ---

function getOriginalInput(): HTMLElement | null {
  return document.querySelector<HTMLElement>(".ComposerInput__input");
}

function injectTextarea() {
  const original = getOriginalInput();
  if (!original || pvkTextarea) return;

  hideOriginalInput();

  pvkTextarea = document.createElement("textarea");
  pvkTextarea.className = "pvk-input";
  pvkTextarea.placeholder = `${LOCK_ICON} Encrypted message (PVK)`;
  pvkTextarea.rows = 1;

  pvkTextarea.addEventListener("input", () => {
    if (!pvkTextarea) return;
    pvkTextarea.style.height = "auto";
    pvkTextarea.style.height = pvkTextarea.scrollHeight + "px";
  });

  // Share key button
  const shareKeyBtn = document.createElement("button");
  shareKeyBtn.className = "pvk-share-key-btn";
  shareKeyBtn.textContent = KEY_ICON;
  shareKeyBtn.title = "Re-send your public key";
  shareKeyBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const privKey = await getPrivateKey();
    if (!privKey) { showToast("No private key set"); return; }
    const pubKey = await getPublicKeyFromPrivate(privKey);
    pasteAndSend(`${PVK_KEY_PREFIX}${pubKey}`);
    showToast("Public key sent!");
  });

  // Send button
  pvkSendBtn = document.createElement("button");
  pvkSendBtn.className = "pvk-send-btn";
  pvkSendBtn.textContent = LOCK_ICON;
  pvkSendBtn.title = "Send encrypted";
  pvkSendBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    sendEncrypted();
  });

  // Wrap in a container
  const wrapper = document.createElement("div");
  wrapper.className = "pvk-composer";
  wrapper.appendChild(shareKeyBtn);
  wrapper.appendChild(pvkTextarea);
  wrapper.appendChild(pvkSendBtn);

  // Insert into the input panel (parent of the wrapper we hide), not inside the hidden wrapper
  const inputPanel = document.querySelector(".ConvoComposer__inputPanel");
  const inputWrapper = getInputWrapper();
  if (inputPanel && inputWrapper) {
    inputPanel.insertBefore(wrapper, inputWrapper);
  } else {
    original.parentElement!.insertBefore(wrapper, original);
  }
}

function removeTextarea() {
  if (pvkTextarea) {
    const wrapper = pvkTextarea.closest(".pvk-composer");
    if (wrapper) wrapper.remove();
    else pvkTextarea.remove();
    pvkTextarea = null;
    pvkSendBtn = null;
  }
  const original = getOriginalInput();
  if (original) {
    showOriginalInput();
  }
}

// --- Generate key button ---

function injectGenerateButton() {
  if (pvkGenerateBtn) return;
  const original = getOriginalInput();
  if (!original) return;

  pvkGenerateBtn = document.createElement("button");
  pvkGenerateBtn.className = "pvk-generate-btn";
  pvkGenerateBtn.textContent = `${KEY_ICON} Generate & Share Key`;
  pvkGenerateBtn.addEventListener("click", handleGenerateKey);

  original.parentElement!.insertBefore(pvkGenerateBtn, original);
}

function removeGenerateButton() {
  if (pvkGenerateBtn) {
    pvkGenerateBtn.remove();
    pvkGenerateBtn = null;
  }
}

function injectShareKeyButton() {
  if (pvkStandaloneShareBtn) return;
  const inputPanel = document.querySelector(".ConvoComposer__inputPanel");
  if (!inputPanel) return;

  pvkStandaloneShareBtn = document.createElement("button");
  pvkStandaloneShareBtn.className = "pvk-share-key-btn";
  pvkStandaloneShareBtn.textContent = KEY_ICON;
  pvkStandaloneShareBtn.title = "Send your public key to this chat";
  pvkStandaloneShareBtn.style.alignSelf = "center";
  pvkStandaloneShareBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const privKey = await getPrivateKey();
    if (!privKey) return;
    const pubKey = await getPublicKeyFromPrivate(privKey);
    pasteAndSend(`${PVK_KEY_PREFIX}${pubKey}`);
    showToast("Public key sent!");
  });

  // Insert before the emoji/mic buttons at the end
  const inputWrapper = getInputWrapper();
  if (inputWrapper) {
    inputPanel.insertBefore(pvkStandaloneShareBtn, inputWrapper);
  } else {
    inputPanel.appendChild(pvkStandaloneShareBtn);
  }
}

function removeShareKeyButton() {
  if (pvkStandaloneShareBtn) {
    pvkStandaloneShareBtn.remove();
    pvkStandaloneShareBtn = null;
  }
}

async function handleGenerateKey() {
  if (pvkGenerateBtn) {
    pvkGenerateBtn.disabled = true;
    pvkGenerateBtn.textContent = "Generating...";
  }

  try {
    const { privateKey, publicKey } = await generateKeyPair();
    await setPrivateKey(privateKey);
    // Send public key as a message so the other side can pick it up
    pasteAndSend(`${PVK_KEY_PREFIX}${publicKey}`);
    showToast("Key generated! Private key saved, public key sent to chat.");

    // Re-check activation since we now have a private key
    setTimeout(() => checkActivation(), 500);
  } catch (err) {
    showToast(`Key generation failed: ${err}`);
  } finally {
    if (pvkGenerateBtn) {
      pvkGenerateBtn.disabled = false;
      pvkGenerateBtn.textContent = `${KEY_ICON} Generate & Share Key`;
    }
  }
}

// --- Send encrypted message ---

async function sendEncrypted() {
  if (!pvkTextarea || !pvkTextarea.value.trim()) return;

  const convoId = getConvoIdFromUrl();
  if (!convoId) return;

  const [privateKey, recipientKey] = await Promise.all([
    getPrivateKey(),
    getRecipientKey(convoId),
  ]);

  if (!privateKey || !recipientKey) {
    showToast("Set your private key and recipient key first!");
    return;
  }
  const plaintext = pvkTextarea.value;
  pvkTextarea.value = "";
  pvkTextarea.style.height = "auto";

  try {
    const encrypted = await encryptMessage(plaintext, recipientKey, privateKey);
    pasteAndSend(encrypted);
  } catch (err) {
    showToast(`Encryption failed: ${err}`);
    pvkTextarea.value = plaintext;
  }
}

function getInputWrapper(): HTMLElement | null {
  return document.querySelector<HTMLElement>(".ComposerInput.ConvoComposer__inputWrapper");
}

function hideOriginalInput() {
  const wrapper = getInputWrapper();
  if (wrapper) {
    wrapper.style.setProperty("display", "none", "important");
  }
}

function showOriginalInput() {
  const wrapper = getInputWrapper();
  if (wrapper) {
    wrapper.style.removeProperty("display");
  }
}

function pasteAndSend(text: string) {
  const original = getOriginalInput();
  if (!original) return;

  // Unhide and focus the real VK input
  showOriginalInput();
  original.focus();

  // Clear existing content
  original.textContent = "";

  // Use execCommand to insert text — this triggers VK's internal listeners
  // which will make the send button appear
  document.execCommand("insertText", false, text);

  // Also dispatch events VK might listen for
  original.dispatchEvent(new Event("input", { bubbles: true }));
  original.dispatchEvent(new Event("change", { bubbles: true }));

  // Wait for VK to react and show the send button
  setTimeout(() => {
    const sendBtn = document.querySelector<HTMLElement>(
      '.ConvoComposer__sendButton--submit'
    );
    if (sendBtn) {
      sendBtn.click();
    } else {
      // Fallback: try pressing Enter on the original input
      original.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Enter", code: "Enter", keyCode: 13, bubbles: true
      }));
    }

    // Re-hide after send
    setTimeout(() => {
      original.textContent = "";
      if (isActive) {
        hideOriginalInput();
      }
    }, 200);
  }, 300);
}

// --- Auto-detect key exchange messages ---

async function handleKeyExchangeMessages() {
  const convoId = getConvoIdFromUrl();
  if (!convoId) return;

  const messages = document.querySelectorAll(
    '[class*="ConvoMessage"]:not([' + KEY_HANDLED_ATTR + "])"
  );

  for (const el of messages) {
    const text = el.textContent || "";
    if (!text.includes(PVK_KEY_PREFIX)) continue;

    el.setAttribute(KEY_HANDLED_ATTR, "true");

    const keyStart = text.indexOf(PVK_KEY_PREFIX) + PVK_KEY_PREFIX.length;
    const keyBlockStart = text.indexOf("-----BEGIN PGP PUBLIC KEY BLOCK-----", keyStart);
    const keyBlockEnd = text.indexOf("-----END PGP PUBLIC KEY BLOCK-----", keyStart);

    if (keyBlockStart === -1 || keyBlockEnd === -1) continue;

    const rawKey = text.substring(keyBlockStart, keyBlockEnd + "-----END PGP PUBLIC KEY BLOCK-----".length);
    const publicKey = normalizeArmored(rawKey);

    // Check if this is our own key (don't save our own public key as recipient)
    const privateKey = await getPrivateKey();
    if (privateKey) {
      try {
        const ownPublic = await getPublicKeyFromPrivate(privateKey);
        // Compare just the base64 body, ignoring formatting differences
        const strip = (s: string) => s.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
        if (strip(ownPublic) === strip(publicKey)) {
          // This is our own key message — just mark it visually
          const ownTextNode = findPgpTextNode(el);
          if (ownTextNode) {
            ownTextNode.innerHTML = `${KEY_ICON} <em>Your public key (shared)</em>`;
            ownTextNode.classList.add("pvk-key-msg");
          } else {
            el.innerHTML = `<span class="pvk-key-msg">${KEY_ICON} <em>Your public key (shared)</em></span>`;
          }
          continue;
        }
      } catch { /* ignore */ }
    }

    // Save as recipient key for this conversation
    await setRecipientKey(convoId, publicKey);
    const keyTextNode = findPgpTextNode(el);
    if (keyTextNode) {
      keyTextNode.innerHTML = `${KEY_ICON} <em>Recipient key received & saved</em>`;
      keyTextNode.classList.add("pvk-key-msg");
    } else {
      el.innerHTML = `<span class="pvk-key-msg">${KEY_ICON} <em>Recipient key received & saved</em></span>`;
    }
    showToast("Recipient public key received and saved!");
    checkActivation();
  }
}

// --- Auto-decrypt messages ---

// Find the text element within a message — only replace the message body, keep sender/time
function findPgpTextNode(el: Element): HTMLElement | null {
  // Target the specific VK message text container
  const messageText = el.querySelector(".MessageText") as HTMLElement | null;
  if (messageText) return messageText;

  // Fallback: look for the text wrapper
  const textWrap = el.querySelector('[class*="__text"]') as HTMLElement | null;
  if (textWrap) return textWrap;

  return null;
}

function extractPgpBlock(text: string): string | null {
  const start = text.indexOf(PGP_HEADER);
  const end = text.indexOf(PGP_FOOTER);
  if (start === -1 || end === -1) return null;
  return text.substring(start, end + PGP_FOOTER.length);
}

async function decryptMessageElements() {
  const privateKey = await getPrivateKey();
  if (!privateKey) return;

  const messages = document.querySelectorAll(
    '[class*="ConvoMessage"]:not([' + DECRYPTED_ATTR + "])"
  );

  for (const el of messages) {
    const text = el.textContent || "";
    // Skip key exchange messages
    if (text.includes(PVK_KEY_PREFIX)) continue;

    const pgpBlock = extractPgpBlock(text);
    if (!pgpBlock) continue;

    el.setAttribute(DECRYPTED_ATTR, "true");

    // Find the deepest text node containing the PGP block and replace just that
    const textSpan = findPgpTextNode(el);

    try {
      const decrypted = await decryptMessage(pgpBlock, privateKey);
      if (textSpan) {
        textSpan.innerHTML = `${LOCK_ICON} ${escapeHtml(decrypted)}`;
        textSpan.classList.add("pvk-decrypted");
      } else {
        el.innerHTML = `<span class="pvk-decrypted">${LOCK_ICON} ${escapeHtml(decrypted)}</span>`;
      }
    } catch {
      if (textSpan) {
        textSpan.innerHTML = `${LOCK_ICON} <em>Could not decrypt</em>`;
        textSpan.classList.add("pvk-decrypt-failed");
      } else {
        el.innerHTML = `<span class="pvk-decrypt-failed">${LOCK_ICON} <em>Could not decrypt</em></span>`;
      }
    }
  }
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// --- Toast notifications ---

function showToast(msg: string) {
  const existing = document.querySelector(".pvk-toast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.className = "pvk-toast";
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

// --- Activation check ---

async function checkActivation() {
  const convoId = getConvoIdFromUrl();
  if (!convoId) {
    deactivate();
    return;
  }

  const [privateKey, recipientKey] = await Promise.all([
    getPrivateKey(),
    getRecipientKey(convoId),
  ]);

  const shouldBeActive = !!(privateKey && recipientKey);

  if (shouldBeActive && !isActive) {
    activate();
  } else if (!shouldBeActive && isActive) {
    deactivate();
  }

  // Show generate button when no private key yet
  // Show share key button when we have private key but no recipient key
  if (!privateKey) {
    injectGenerateButton();
    removeShareKeyButton();
  } else {
    removeGenerateButton();
    if (!recipientKey && !isActive) {
      injectShareKeyButton();
    } else {
      removeShareKeyButton();
    }
  }

  // Always process key exchange and decrypt
  handleKeyExchangeMessages();
  if (privateKey) {
    decryptMessageElements();
  }
}

function activate() {
  isActive = true;
  injectTextarea();
  colorSendButton(true);
  removeGenerateButton();
}

function deactivate() {
  isActive = false;
  removeTextarea();
  removeShareKeyButton();
  removeGenerateButton();
  colorSendButton(false);
}

// --- Init ---

function init() {
  // Global capture-phase Enter interceptor — VK has its own Enter handler
  // that swallows the event before it reaches our textarea
  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && document.activeElement === pvkTextarea) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      sendEncrypted();
    }
  }, true);

  checkActivation();

  const observer = new MutationObserver(() => {
    checkActivation();
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      deactivate();
      checkActivation();
    }
  }, 500);

  chrome.storage.onChanged.addListener(() => {
    checkActivation();
  });
}

function waitForComposer() {
  if (getOriginalInput()) {
    init();
  } else {
    const observer = new MutationObserver((_, obs) => {
      if (getOriginalInput()) {
        obs.disconnect();
        init();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }
}

waitForComposer();
