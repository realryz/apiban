import {
  type ChatInputCommandInteraction,
  Client,
  DiscordAPIError,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  MessageFlags,
  RESTJSONErrorCodes,
  SlashCommandBuilder,
} from 'discord.js';

function env(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`Missing environment variable ${name} (see .env.example)`);
    process.exit(1);
  }
  return value;
}

const TOKEN = env('DISCORD_BOT_TOKEN');
const GUILD_ID = env('DISCORD_GUILD_ID');
const ROLE_ID = env('DISCORD_ROLE_ID');
const API_URL = env('APIBAN_API_URL').replace(/\/+$/, '');
const API_KEY = env('APIBAN_BOT_KEY');

const SYNC_INTERVAL_MS = 60_000;
const BRAND = 0xfda3bd;
const MUTED = 0x4a4441;

const authCommand = new SlashCommandBuilder()
  .setName('auth')
  .setDescription('Get a 6-digit code to create an apiban API key in the panel');

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      ...(body !== undefined && { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await response.json().catch(() => null)) as { error?: string } | null;
  if (!response.ok) throw new Error(data?.error ?? `apiban API answered with HTTP ${response.status}`);
  return data as T;
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

async function hasRole(userId: string): Promise<boolean> {
  const guild = await client.guilds.fetch(GUILD_ID);
  try {
    const member = await guild.members.fetch({ user: userId, force: true });
    return member.roles.cache.has(ROLE_ID);
  } catch (error) {
    const gone = [RESTJSONErrorCodes.UnknownMember, RESTJSONErrorCodes.UnknownUser];
    if (error instanceof DiscordAPIError && gone.includes(error.code as RESTJSONErrorCodes)) return false;
    throw error;
  }
}

function card(title: string, description: string, color = BRAND) {
  return new EmbedBuilder().setColor(color).setAuthor({ name: '✹ apiban' }).setTitle(title).setDescription(description);
}

async function handleAuth(interaction: ChatInputCommandInteraction) {
  if (interaction.guildId !== GUILD_ID) {
    await interaction.reply({ content: 'Use `/auth` on the server.', flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (!(await hasRole(interaction.user.id))) {
    await interaction.editReply({
      embeds: [card('No access', `You need the <@&${ROLE_ID}> role to use apiban.`, MUTED)],
    });
    return;
  }

  const { code, expires_at } = await api<{ code: string; expires_at: number }>('POST', '/v1/auth/codes', {
    discord_id: interaction.user.id,
    discord_name: interaction.user.username,
  });

  await interaction.editReply({
    embeds: [
      card(
        'Your auth code',
        `# \`${code}\`\nEnter it in the apiban panel under **Settings → API keys**.\nExpires <t:${expires_at}:R>.`,
      ).setFooter({ text: 'Only you can see this message. Never share the code.' }),
    ],
  });
  console.log(`Issued an auth code to ${interaction.user.username}`);
}

async function syncKeys() {
  try {
    const { discord_ids } = await api<{ discord_ids: string[] }>('GET', '/v1/keys/owners');
    for (const id of discord_ids) {
      let allowed: boolean;
      try {
        allowed = await hasRole(id);
      } catch (error) {
        console.warn(`Could not check the role of ${id}: ${(error as Error).message}`);
        continue;
      }
      if (allowed) continue;
      const { revoked } = await api<{ revoked: number }>('DELETE', `/v1/users/${id}/keys`);
      console.log(`Revoked ${revoked} API key(s) of ${id}: the role is missing`);
    }
  } catch (error) {
    console.error(`Key sync failed: ${(error as Error).message}`);
  }
}

client.once(Events.ClientReady, async (ready) => {
  const guild = await ready.guilds.fetch(GUILD_ID);
  await guild.commands.set([authCommand.toJSON()]);
  console.log(`Logged in as ${ready.user.tag}, /auth is registered on ${guild.name}`);

  await syncKeys();
  setInterval(syncKeys, SYNC_INTERVAL_MS);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand() || interaction.commandName !== authCommand.name) return;
  try {
    await handleAuth(interaction);
  } catch (error) {
    console.error(`/auth failed for ${interaction.user.username}: ${(error as Error).message}`);
    const message = { embeds: [card('Something went wrong', 'The apiban API is not reachable. Try again in a moment.', MUTED)] };
    if (interaction.deferred || interaction.replied) await interaction.editReply(message).catch(() => {});
    else await interaction.reply({ ...message, flags: MessageFlags.Ephemeral }).catch(() => {});
  }
});

client.login(TOKEN).catch((error: Error) => {
  console.error(`Discord login failed: ${error.message}`);
  process.exit(1);
});
