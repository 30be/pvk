import * as openpgp from "openpgp";

// VK strips line breaks from messages, so PGP armored text gets mangled.
// This reconstructs proper armor format from collapsed text.
export function normalizeArmored(mangled: string): string {
  // Extract header and footer — works for keys AND messages
  const headerMatch = mangled.match(/(-----BEGIN PGP [A-Z ]+-----)/);
  const footerMatch = mangled.match(/(-----END PGP [A-Z ]+-----)/);
  if (!headerMatch?.[1] || !footerMatch?.[1]) return mangled;

  const header = headerMatch[1];
  const footer = footerMatch[1];

  // Extract the body between header and footer
  const headerEnd = mangled.indexOf(header) + header.length;
  const footerStart = mangled.indexOf(footer);
  let body = mangled.substring(headerEnd, footerStart).trim();

  // Remove any "Version:" or other armor headers that got merged
  body = body.replace(/Version:[^\s]*/g, "").trim();

  // Remove all whitespace from the base64 body
  body = body.replace(/\s+/g, "");

  // Split the checksum (last 5 chars starting with =)
  let checksum = "";
  const checksumMatch = body.match(/=([A-Za-z0-9+/]{4})$/);
  if (checksumMatch) {
    checksum = checksumMatch[0];
    body = body.slice(0, -5);
  }

  // Re-wrap base64 at 76 chars per line
  const lines: string[] = [];
  for (let i = 0; i < body.length; i += 76) {
    lines.push(body.substring(i, i + 76));
  }

  return [header, "", ...lines, checksum, footer].join("\n");
}

export async function generateKeyPair(): Promise<{ privateKey: string; publicKey: string }> {
  const { privateKey, publicKey } = await openpgp.generateKey({
    type: "ecc",
    curve: "curve25519Legacy",
    userIDs: [{ name: "PVK User" }],
    format: "armored",
  });
  return { privateKey, publicKey };
}

export async function getPublicKeyFromPrivate(privateKeyArmored: string): Promise<string> {
  const privKey = await openpgp.readPrivateKey({ armoredKey: privateKeyArmored });
  return privKey.toPublic().armor();
}

export async function encryptMessage(
  text: string,
  recipientArmoredKey: string,
  privateKeyArmored: string
): Promise<string> {
  const recipientKey = await openpgp.readKey({ armoredKey: normalizeArmored(recipientArmoredKey) });
  const privKey = await openpgp.readPrivateKey({ armoredKey: normalizeArmored(privateKeyArmored) });
  const ownPublicKey = privKey.toPublic();

  const message = await openpgp.createMessage({ text });
  const encrypted = await openpgp.encrypt({
    message,
    encryptionKeys: [recipientKey, ownPublicKey],
  });

  return encrypted as string;
}

export async function decryptMessage(
  armoredMessage: string,
  privateKeyArmored: string
): Promise<string> {
  const privateKey = await openpgp.readPrivateKey({ armoredKey: normalizeArmored(privateKeyArmored) });
  const message = await openpgp.readMessage({ armoredMessage: normalizeArmored(armoredMessage) });

  const { data } = await openpgp.decrypt({
    message,
    decryptionKeys: privateKey,
  });

  return data as string;
}
