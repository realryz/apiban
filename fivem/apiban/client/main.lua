local banned = false

-- Sent by the server right before the player is dropped. Display only:
-- the server drops the player whether or not this screen is shown.
RegisterNetEvent('apiban:banned', function(ban, seconds)
    if banned then return end
    banned = true

    SendNUIMessage({ type = 'banned', ban = ban, seconds = seconds })
    SetNuiFocus(true, false)
    AnimpostfxPlay('DeathFailOut', 0, true)

    CreateThread(function()
        while banned do
            DisableAllControlActions(0)
            Wait(0)
        end
    end)
end)
