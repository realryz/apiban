-- Server-side only: this file is never sent to players.
-- The API URL and key are NOT set here but in server.cfg:
--   set apiban_url "https://api.example.com"
--   set apiban_key "apiban_..."
Config = {}

-- Shown on the ban card and the ban screen.
Config.ServerName = 'My FiveM Server'

-- Where banned players can appeal (Discord invite, website, ...). Set to nil to hide it.
Config.AppealUrl = 'https://discord.gg/your-invite'

-- Seconds the ban screen is shown to an online player before they are dropped.
Config.KickDelay = 10

-- true: players can still join while the API is unreachable.
-- false: nobody can join until the API is back.
Config.AllowJoinWhenApiDown = true

-- Identifier types that are not stored in bans. IPs change and are shared, so they are skipped.
Config.IgnoredIdentifiers = { ip = true }

-- Also store the player's hardware tokens (GetPlayerToken). Catches most alt accounts.
Config.UseHardwareTokens = true
