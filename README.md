# Discord Server Reset Bot

A destructive Discord server cleanup bot with a single `/reset server` command and a selection UI.

## Reset options

- Channels — deletes categories, text, voice, forum, stage, announcement, etc. where the bot has permission.
- Roles — deletes normal roles. Never deletes @everyone or managed/integration roles.
- Emojis & Stickers — deletes custom emojis and stickers where permitted.
- Server Settings — resets supported guild settings to Discord defaults.
- Everything — performs all available reset operations.
- Messages — optional purge of recent messages from channels that still exist. Discord bulk-delete limitations apply.

## Safety

Every destructive reset requires:
1. `/reset server`
2. Choose options
3. Confirm button
4. Type `RESET` in the final confirmation modal

The bot also creates an emergency JSON snapshot before the reset when possible.

## Install

npm install
npm start

Set DISCORD_TOKEN, CLIENT_ID and optionally GUILD_ID.

## Bot permissions

Manage Channels
Manage Roles
Manage Emojis and Stickers
Manage Server
View Channels
Send Messages
Read Message History

The bot's highest role must be above roles it needs to delete.

## Railway

Deploy this project to Railway as a persistent service. Store DISCORD_TOKEN as a Railway secret/environment variable.

The bot does not require a database.
