fx_version 'cerulean'
game 'gta5'
lua54 'yes'

name 'apiban'
description 'Ban system backed by the apiban API (bans from the web dashboard or an iPhone shortcut)'
author 'realryz'
version '1.0.0'

server_scripts {
    'config.lua',
    'server/main.lua',
}

client_script 'client/main.lua'

ui_page 'html/index.html'

files {
    'html/index.html',
    'html/style.css',
    'html/script.js',
}
