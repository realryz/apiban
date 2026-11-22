local API_URL = (GetConvar('apiban_url', 'http://127.0.0.1:8080'):gsub('/+$', ''))
local API_KEY = GetConvar('apiban_key', '')
local HEARTBEAT_INTERVAL = 3000

if API_KEY == '' then
    print('^1[apiban] apiban_key is not set. Add  set apiban_key "apiban_..."  to server.cfg.^0')
end

---------------------------------------------------------------------------
-- API
---------------------------------------------------------------------------

local function request(method, path, body, cb, actor)
    local headers = {
        ['Content-Type'] = 'application/json',
        ['Authorization'] = 'Bearer ' .. API_KEY,
    }
    if actor then headers['X-Apiban-Actor'] = actor end

    PerformHttpRequest(API_URL .. path, function(status, text)
        local data
        if text and text ~= '' then
            local ok, decoded = pcall(json.decode, text)
            if ok then data = decoded end
        end
        cb(status >= 200 and status < 300, status, data)
    end, method, body and json.encode(body) or '', headers)
end

local function apiError(status, data)
    if type(data) == 'table' and data.error then return data.error end
    if status == 0 then return 'API unreachable' end
    return ('HTTP %d'):format(status)
end

---------------------------------------------------------------------------
-- Helpers
---------------------------------------------------------------------------

local function collectIdentifiers(src)
    local list = {}
    for _, identifier in ipairs(GetPlayerIdentifiers(src)) do
        local kind = identifier:match('^([^:]+):')
        if kind and not Config.IgnoredIdentifiers[kind] then
            list[#list + 1] = identifier
        end
    end
    if Config.UseHardwareTokens then
        for i = 0, GetNumPlayerTokens(src) - 1 do
            local token = GetPlayerToken(src, i)
            if token then list[#list + 1] = 'token:' .. token end
        end
    end
    return list
end

local function formatDate(timestamp)
    return os.date('!%d %b %Y, %H:%M UTC', math.floor(timestamp))
end

local function formatRemaining(seconds)
    if seconds < 60 then return 'less than a minute' end
    local parts = {}
    for _, unit in ipairs({ { 86400, 'day' }, { 3600, 'hour' }, { 60, 'minute' } }) do
        local count = math.floor(seconds / unit[1])
        if count > 0 then
            parts[#parts + 1] = ('%d %s%s'):format(count, unit[2], count == 1 and '' or 's')
            seconds = seconds - count * unit[1]
        end
        if #parts == 2 then break end
    end
    return table.concat(parts, ' ')
end

local function expiryText(ban)
    if not ban.expires_at then return 'Never (permanent)' end
    return ('%s (in %s)'):format(formatDate(ban.expires_at), formatRemaining(ban.expires_at - os.time()))
end

-- Plain-text message shown by FiveM when the player is dropped.
local function kickMessage(ban)
    local lines = {
        ('You are banned from %s.'):format(Config.ServerName),
        ('Reason: %s'):format(ban.reason),
        ('Expires: %s'):format(expiryText(ban)),
        ('Ban ID: #%d'):format(ban.id),
    }
    if Config.AppealUrl then lines[#lines + 1] = ('Appeal: %s'):format(Config.AppealUrl) end
    return table.concat(lines, '\n')
end

-- Adaptive card shown in the connecting screen when a banned player tries to join.
local function banCard(ban)
    local actions = {}
    if Config.AppealUrl then
        actions[#actions + 1] = { type = 'Action.OpenUrl', title = 'Appeal this ban', url = Config.AppealUrl }
    end
    actions[#actions + 1] = { type = 'Action.Submit', title = 'Disconnect' }

    return json.encode({
        type = 'AdaptiveCard',
        version = '1.3',
        ['$schema'] = 'http://adaptivecards.io/schemas/adaptive-card.json',
        body = {
            {
                type = 'Container',
                style = 'attention',
                bleed = true,
                items = {
                    { type = 'TextBlock', text = Config.ServerName:upper(), size = 'Small', weight = 'Bolder', isSubtle = true },
                    { type = 'TextBlock', text = 'You are banned', size = 'ExtraLarge', weight = 'Bolder', color = 'Attention', spacing = 'None' },
                },
            },
            { type = 'TextBlock', text = 'REASON', size = 'Small', weight = 'Bolder', isSubtle = true, spacing = 'Large' },
            { type = 'TextBlock', text = ban.reason, size = 'Medium', wrap = true, spacing = 'Small' },
            {
                type = 'FactSet',
                spacing = 'Large',
                facts = {
                    { title = 'Ban ID', value = ('#%d'):format(ban.id) },
                    { title = 'Banned by', value = ban.banned_by },
                    { title = 'Banned on', value = formatDate(ban.created_at) },
                    { title = 'Expires', value = expiryText(ban) },
                },
            },
            {
                type = 'TextBlock',
                text = 'If you think this is a mistake, appeal and include your Ban ID.',
                size = 'Small',
                isSubtle = true,
                wrap = true,
                spacing = 'Large',
            },
        },
        actions = actions,
    })
end

---------------------------------------------------------------------------
-- Enforcing bans
---------------------------------------------------------------------------

local kicking = {}

-- Shows the ban screen to an online player, then drops them.
local function enforce(src, ban)
    src = tonumber(src)
    if not src or kicking[src] or not GetPlayerName(src) then return end
    kicking[src] = true
    print(('[apiban] enforcing ban #%d on %s (id %d)'):format(ban.id, GetPlayerName(src), src))

    TriggerClientEvent('apiban:banned', src, {
        id = ban.id,
        reason = ban.reason,
        banned_by = ban.banned_by,
        created_at = ban.created_at,
        expires_at = ban.expires_at,
        server = Config.ServerName,
        appeal = Config.AppealUrl,
    }, Config.KickDelay)

    SetTimeout(Config.KickDelay * 1000, function()
        kicking[src] = nil
        if GetPlayerName(src) then DropPlayer(src, kickMessage(ban)) end
    end)
end

AddEventHandler('playerConnecting', function(_, _, deferrals)
    local src = source
    deferrals.defer()
    Wait(0)
    deferrals.update(('Checking ban status on %s...'):format(Config.ServerName))

    request('POST', '/v1/server/check', { identifiers = collectIdentifiers(src) }, function(ok, status, data)
        if not ok or type(data) ~= 'table' then
            print(('^3[apiban] ban check failed: %s^0'):format(apiError(status, data)))
            if Config.AllowJoinWhenApiDown then
                deferrals.done()
            else
                deferrals.done('The ban service is unreachable. Please try again in a minute.')
            end
            return
        end
        if not data.banned then return deferrals.done() end

        local ban = data.ban
        local finished = false
        local function reject()
            if finished then return end
            finished = true
            deferrals.done(kickMessage(ban))
        end
        print(('[apiban] blocked %s: ban #%d'):format(GetPlayerName(src) or src, ban.id))
        deferrals.presentCard(banCard(ban), reject)
        SetTimeout(60000, reject)
    end)
end)

---------------------------------------------------------------------------
-- Heartbeat: report online players, kick the ones banned from outside
---------------------------------------------------------------------------

local apiDown = false

local function heartbeat()
    local players = {}
    for _, id in ipairs(GetPlayers()) do
        players[#players + 1] = {
            id = tonumber(id),
            name = GetPlayerName(id),
            identifiers = collectIdentifiers(id),
        }
    end

    request('POST', '/v1/server/heartbeat', { players = players }, function(ok, status, data)
        if not ok then
            if not apiDown then
                apiDown = true
                print(('^1[apiban] heartbeat failed: %s^0'):format(apiError(status, data)))
            end
            return
        end
        if apiDown then
            apiDown = false
            print('^2[apiban] connection to the API restored^0')
        end
        for _, kick in ipairs(type(data) == 'table' and data.kicks or {}) do
            enforce(kick.player, kick.ban)
        end
    end)
end

CreateThread(function()
    while true do
        heartbeat()
        Wait(HEARTBEAT_INTERVAL)
    end
end)

---------------------------------------------------------------------------
-- In-game commands and export
---------------------------------------------------------------------------

-- exports.apiban:BanPlayer(serverId, reason, duration, bannedBy, cb)
-- duration: '30m', '12h', '7d', '2w', '1y' or nil/'perm'. cb(ok, message, ban) is optional.
local function banPlayer(target, reason, duration, actor, cb)
    cb = cb or function() end
    target = tonumber(target)
    if not target or not GetPlayerName(target) then return cb(false, 'player is not online') end

    request('POST', '/v1/bans', {
        identifiers = collectIdentifiers(target),
        name = GetPlayerName(target),
        reason = reason,
        duration = duration,
    }, function(ok, status, data)
        if not ok then return cb(false, apiError(status, data)) end
        enforce(target, data.ban)
        cb(true, data.message, data.ban)
    end, actor)
end

exports('BanPlayer', banPlayer)

local function reply(src, message, isError)
    if src == 0 then return print(('[apiban] %s'):format(message)) end
    TriggerClientEvent('chat:addMessage', src, {
        color = isError and { 255, 90, 90 } or { 120, 220, 140 },
        args = { 'apiban', message },
    })
end

local function allowed(src)
    return src == 0 or IsPlayerAceAllowed(src, 'apiban.ban')
end

local function actorName(src)
    return src == 0 and 'console' or GetPlayerName(src)
end

RegisterCommand('ban', function(src, args)
    if not allowed(src) then return reply(src, 'You are not allowed to use this command.', true) end
    local target, duration, reason = args[1], args[2], table.concat(args, ' ', 3)
    if not target or not duration or reason == '' then
        return reply(src, 'Usage: /ban <id> <30m|12h|7d|perm> <reason>', true)
    end
    banPlayer(target, reason, duration, actorName(src), function(ok, message)
        reply(src, ok and message or ('Ban failed: ' .. message), not ok)
    end)
end, false)

RegisterCommand('unban', function(src, args)
    if not allowed(src) then return reply(src, 'You are not allowed to use this command.', true) end
    local id = tonumber((args[1] or ''):match('^#?(%d+)$'))
    if not id then return reply(src, 'Usage: /unban <ban id>', true) end
    request('DELETE', ('/v1/bans/%d'):format(id), nil, function(ok, status, data)
        reply(src, ok and data.message or ('Unban failed: ' .. apiError(status, data)), not ok)
    end, actorName(src))
end, false)
