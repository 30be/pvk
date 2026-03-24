const PRIVATE_KEY = "pvk_private_key";
const RECIPIENT_PREFIX = "pvk_recipient_";

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

export function getPrivateKey(): Promise<string | null> {
  return get(PRIVATE_KEY);
}

export function setPrivateKey(key: string): Promise<void> {
  return set(PRIVATE_KEY, key);
}

export function getRecipientKey(convoId: string): Promise<string | null> {
  return get(RECIPIENT_PREFIX + convoId);
}

export function setRecipientKey(convoId: string, key: string): Promise<void> {
  return set(RECIPIENT_PREFIX + convoId, key);
}

export function getConvoIdFromUrl(): string | null {
  const match = location.pathname.match(/\/im\/convo\/(\d+)/);
  return match ? match[1] : null;
}
