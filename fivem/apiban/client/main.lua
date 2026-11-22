local banned = false

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
