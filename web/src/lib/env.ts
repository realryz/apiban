type Name =
  | 'APP_URL'
  | 'SESSION_SECRET'
  | 'APIBAN_API_URL'
  | 'APIBAN_PANEL_KEY'
  | 'DISCORD_CLIENT_ID'
  | 'DISCORD_CLIENT_SECRET'
  | 'DISCORD_BOT_TOKEN'
  | 'DISCORD_GUILD_ID'
  | 'DISCORD_ROLE_ID';

export function env(name: Name): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing environment variable ${name}, see web/.env.example`);
  if (name === 'SESSION_SECRET' && value.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters');
  return name.endsWith('_URL') ? value.replace(/\/+$/, '') : value;
}

export function isHttps() {
  return env('APP_URL').startsWith('https://');
}
