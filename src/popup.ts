const PRIVATE_KEY = "pvk_private_key";
const RECIPIENT_PREFIX = "pvk_recipient_";

const privateKeyEl = document.getElementById("privateKey") as HTMLTextAreaElement;
const recipientKeyEl = document.getElementById("recipientKey") as HTMLTextAreaElement;
const statusEl = document.getElementById("status")!;
const convoIdEl = document.getElementById("convoId")!;

let currentConvoId: string | null = null;

async function getActiveTabConvoId(): Promise<string | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) return null;
  const match = tab.url.match(/\/im\/convo\/(\d+)/);
  return match?.[1] ?? null;
}

function get(key: string): Promise<string | null> {
  return new Promise((resolve) => {
    chrome.storage.local.get(key, (result) => resolve((result[key] as string) ?? null));
  });
}

function set(key: string, value: string): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [key]: value }, resolve);
  });
}

async function loadKeys() {
  currentConvoId = await getActiveTabConvoId();

  privateKeyEl.value = (await get(PRIVATE_KEY)) ?? "";

  if (currentConvoId) {
    convoIdEl.textContent = `Chat ID: ${currentConvoId}`;
    recipientKeyEl.value = (await get(RECIPIENT_PREFIX + currentConvoId)) ?? "";
    recipientKeyEl.disabled = false;
  } else {
    convoIdEl.textContent = "Open a VK conversation to set recipient key";
    recipientKeyEl.disabled = true;
    recipientKeyEl.placeholder = "Open a VK conversation first...";
  }

  updateStatus();
}

function updateStatus() {
  const hasPrivate = privateKeyEl.value.includes("BEGIN PGP PRIVATE KEY");
  const hasRecipient = recipientKeyEl.value.includes("BEGIN PGP PUBLIC KEY");

  if (hasPrivate && hasRecipient) {
    statusEl.className = "status ok";
    statusEl.textContent = "Ready — messages will be encrypted";
  } else {
    statusEl.className = "status warn";
    const missing: string[] = [];
    if (!hasPrivate) missing.push("private key");
    if (!hasRecipient) missing.push("recipient key");
    statusEl.textContent = `Missing: ${missing.join(", ")}`;
  }
}

function autoSave(el: HTMLTextAreaElement, key: string) {
  let timer: ReturnType<typeof setTimeout>;
  el.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      set(key, el.value);
      updateStatus();
    }, 300);
  });
}

autoSave(privateKeyEl, PRIVATE_KEY);

let recipientTimer: ReturnType<typeof setTimeout>;
recipientKeyEl.addEventListener("input", () => {
  clearTimeout(recipientTimer);
  recipientTimer = setTimeout(() => {
    if (currentConvoId) {
      set(RECIPIENT_PREFIX + currentConvoId, recipientKeyEl.value);
      updateStatus();
    }
  }, 300);
});

loadKeys();
