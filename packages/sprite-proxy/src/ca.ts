import { readFileSync } from "node:fs";
import tls from "node:tls";
import forge from "node-forge";

/**
 * Mints per-host leaf certificates signed by the per-sprite CA so the proxy can
 * terminate TLS for intercepted hosts. The CA private key lives on the sprite,
 * which is safe by design: it only ever signs certs for the proxy's own
 * interception — the real upstream secrets are injected by the worker, not the
 * sprite, so a leaked CA key grants nothing.
 */
export class CertMinter {
  private readonly caCert: forge.pki.Certificate;
  private readonly caKey: forge.pki.rsa.PrivateKey;
  private readonly leafKeys: forge.pki.rsa.KeyPair;
  private readonly leafKeyPem: string;
  private readonly caCertPem: string;
  private readonly cache = new Map<string, tls.SecureContext>();

  constructor(caCertPath: string, caKeyPath: string) {
    this.caCertPem = readFileSync(caCertPath, "utf8");
    const caKeyPem = readFileSync(caKeyPath, "utf8");
    this.caCert = forge.pki.certificateFromPem(this.caCertPem);
    this.caKey = forge.pki.privateKeyFromPem(caKeyPem) as forge.pki.rsa.PrivateKey;
    // One leaf keypair reused across all hosts (only the cert varies). Generating
    // a 2048-bit key per host would add ~100ms of latency to each new host.
    this.leafKeys = forge.pki.rsa.generateKeyPair(2048);
    this.leafKeyPem = forge.pki.privateKeyToPem(this.leafKeys.privateKey);
  }

  secureContextFor(host: string): tls.SecureContext {
    const cached = this.cache.get(host);
    if (cached) {
      return cached;
    }
    const leafPem = this.mintLeafPem(host);
    const context = tls.createSecureContext({
      key: this.leafKeyPem,
      cert: leafPem + this.caCertPem,
    });
    this.cache.set(host, context);
    return context;
  }

  private mintLeafPem(host: string): string {
    const cert = forge.pki.createCertificate();
    cert.publicKey = this.leafKeys.publicKey;
    cert.serialNumber = serialFor(host);
    cert.validity.notBefore = new Date(Date.now() - 60_000);
    const notAfter = new Date();
    notAfter.setFullYear(notAfter.getFullYear() + 1);
    cert.validity.notAfter = notAfter;
    cert.setSubject([{ name: "commonName", value: host }]);
    cert.setIssuer(this.caCert.subject.attributes);
    cert.setExtensions([
      { name: "basicConstraints", cA: false },
      { name: "keyUsage", digitalSignature: true, keyEncipherment: true },
      { name: "extKeyUsage", serverAuth: true },
      { name: "subjectAltName", altNames: [{ type: 2, value: host }] },
    ]);
    cert.sign(this.caKey, forge.md.sha256.create());
    return forge.pki.certificateToPem(cert);
  }
}

/** Deterministic positive hex serial derived from the host. */
function serialFor(host: string): string {
  let hash = 0;
  for (let i = 0; i < host.length; i++) {
    hash = (hash * 31 + host.charCodeAt(i)) >>> 0;
  }
  return `01${hash.toString(16).padStart(8, "0")}`;
}
