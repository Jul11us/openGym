// A source download needs binding names, never the identity of a live deployment.
export function publicSourceHostingConfig(config) {
  const publicConfig = {};
  for (const binding of ['d1', 'r2']) {
    if (typeof config[binding] === 'string' && /^[A-Z][A-Z0-9_]*$/.test(config[binding])) {
      publicConfig[binding] = config[binding];
    }
  }
  return publicConfig;
}

export function sourceFileAllowed(relative) {
  const name = relative.replaceAll('\\', '/').split('/').at(-1);
  return !name.startsWith('.env') && !/\.(?:log|sqlite3?|db|pem|key|p12|pfx|tar|zip)$/i.test(name);
}
