// bootstrap.js — Crypto polyfill for x402 (REQUIRED)
// Node.js needs Web Crypto API globally available for x402 SDK
// This file MUST be the entry point (not api.js directly)

import { webcrypto } from 'crypto';

if (typeof globalThis.crypto === 'undefined') {
  globalThis.crypto = webcrypto;
}

// Now load the main API
import('./api.js');
