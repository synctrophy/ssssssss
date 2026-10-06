const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  EmbedBuilder,
  ChannelType
} = require("discord.js");
const fs = require("fs");
const path = require("path");

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

if (!TOKEN || !CLIENT_ID) {
  console.error("Missing DISCORD_TOKEN or CLIENT_ID.");
  process.exit(1);
}

const DATA_DIR = path.join(process.cwd(), "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const commands = [
  new SlashCommandBuilder()
    .setName("reset")
    .setDescription("Reset or clean up this Discord server.")
    .addSubcommand(s =>
      s.setName("server")
        .setDescription("Open the server reset menu."))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator.toString())
    .toJSON()
];

const sessions = new Map();

function authorized(i) {
  return i.memberPermissions?.has(PermissionFlagsBits.Administrator) ||
         i.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
}

function snapshotPath(guildId) {
  return path.join(DATA_DIR, `${guildId}-pre-reset-${Date.now()}.json`);
}

async function snapshot(guild) {
  await guild.channels.fetch();
  await guild.roles.fetch();

  const data = {
    createdAt: new Date().toISOString(),
    guildId: guild.id,
    guildName: guild.name,
    roles: guild.roles.cache
      .filter(r => !r.managed)
      .map(r => ({
        id: r.id,
        name: r.name,
        color: r.hexColor,
        hoist: r.hoist,
        mentionable: r.mentionable,
        permissions: r.permissions.bitfield.toString(),
        position: r.position
      })),
    channels: guild.channels.cache
      .filter(c => !c.isThread())
      .map(c => ({
        id: c.id,
        name: c.name,
        type: c.type,
        parentId: c.parentId,
        position: c.rawPosition
      })),
    settings: {
      name: guild.name,
      verificationLevel: guild.verificationLevel,
      defaultMessageNotifications: guild.defaultMessageNotifications,
      explicitContentFilter: guild.explicitContentFilter,
      afkTimeout: guild.afkTimeout,
      afkChannelId: guild.afkChannelId,
      systemChannelId: guild.systemChannelId
    }
  };

  const file = snapshotPath(guild.id);
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  return file;
}

async function deleteChannels(guild) {
  await guild.channels.fetch();

  const channels = [...guild.channels.cache.values()]
    .filter(c => !c.isThread() && c.deletable)
    .sort((a,b) => b.rawPosition - a.rawPosition);

  let deleted = 0;
  let skipped = 0;

  for (const channel of channels) {
    try {
      await channel.delete("Server reset requested by administrator");
      deleted++;
    } catch {
      skipped++;
    }
  }

  return { deleted, skipped };
}

async function deleteRoles(guild) {
  await guild.roles.fetch();

  const roles = [...guild.roles.cache.values()]
    .filter(r => r.id !== guild.id && !r.managed && r.editable)
    .sort((a,b) => b.position - a.position);

  let deleted = 0;
  let skipped = 0;

  for (const role of roles) {
    try {
      await role.delete("Server reset requested by administrator");
      deleted++;
    } catch {
      skipped++;
    }
  }

  return { deleted, skipped };
}

async function deleteEmojis(guild) {
  await guild.emojis.fetch();

  let deleted = 0;
  let skipped = 0;

  for (const emoji of guild.emojis.cache.values()) {
    try {
      await emoji.delete("Server reset requested by administrator");
      deleted++;
    } catch {
      skipped++;
    }
  }

  if (guild.stickers) {
    const stickers = await guild.stickers.fetch().catch(() => null);
    if (stickers) {
      for (const sticker of stickers.values()) {
        try {
          await sticker.delete("Server reset requested by administrator");
          deleted++;
        } catch {
          skipped++;
        }
      }
    }
  }

  return { deleted, skipped };
}

async function resetSettings(guild) {
  await guild.edit({
    verificationLevel: 0,
    defaultMessageNotifications: 0,
    explicitContentFilter: 0,
    afkTimeout: 300,
    afkChannel: null,
    systemChannel: null
  }).catch(() => {});

  return true;
}

async function purgeMessages(guild) {
  await guild.channels.fetch();

  let deleted = 0;
  let skipped = 0;

  for (const channel of guild.channels.cache.values()) {
    if (!channel.isTextBased() || !channel.messages?.fetch || !channel.permissionsFor(guild.members.me)?.has(PermissionFlagsBits.ManageMessages)) {
      continue;
    }

    try {
      const messages = await channel.messages.fetch({ limit: 100 });
      if (messages.size) {
        const result = await channel.bulkDelete(messages, true);
        deleted += result.size;
      }
    } catch {
      skipped++;
    }
  }

  return { deleted, skipped };
}

function makeMenu() {
  return new StringSelectMenuBuilder()
    .setCustomId("reset_options")
    .setPlaceholder("Choose what you want to reset...")
    .setMinValues(1)
    .setMaxValues(5)
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel("Channels")
        .setDescription("Delete all manageable categories and channels")
        .setValue("channels")
        .setEmoji("🗂️"),
      new StringSelectMenuOptionBuilder()
        .setLabel("Roles")
        .setDescription("Delete all normal roles")
        .setValue("roles")
        .setEmoji("🎭"),
      new StringSelectMenuOptionBuilder()
        .setLabel("Emojis & Stickers")
        .setDescription("Delete custom emojis and stickers")
        .setValue("emojis")
        .setEmoji("😀"),
      new StringSelectMenuOptionBuilder()
        .setLabel("Messages")
        .setDescription("Delete recent messages from accessible text channels")
        .setValue("messages")
        .setEmoji("🧹"),
      new StringSelectMenuOptionBuilder()
        .setLabel("Server Settings")
        .setDescription("Reset supported server settings to defaults")
        .setValue("settings")
        .setEmoji("⚙️")
    );
}

function labelFor(x) {
  return {
    channels: "🗂️ Channels",
    roles: "🎭 Roles",
    emojis: "😀 Emojis & Stickers",
    messages: "🧹 Messages",
    settings: "⚙️ Server Settings"
  }[x] || x;
}

async function runReset(guild, options) {
  const results = {};

  if (options.includes("channels")) results.channels = await deleteChannels(guild);
  if (options.includes("roles")) results.roles = await deleteRoles(guild);
  if (options.includes("emojis")) results.emojis = await deleteEmojis(guild);
  if (options.includes("messages")) results.messages = await purgeMessages(guild);
  if (options.includes("settings")) results.settings = await resetSettings(guild);

  return results;
}

function resultText(results) {
  const lines = [];

  for (const [type, r] of Object.entries(results)) {
    if (r === true) {
      lines.push(`${labelFor(type)}: **reset**`);
    } else {
      lines.push(`${labelFor(type)}: **${r.deleted} deleted**, **${r.skipped} skipped**`);
    }
  }

  return lines.join("\n");
}

client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);

  const rest = new REST({ version: "10" }).setToken(TOKEN);
  const route = GUILD_ID
    ? Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID)
    : Routes.applicationCommands(CLIENT_ID);

  await rest.put(route, { body: commands });

  console.log("Reset command registered.");
  client.user.setActivity("server resets", { type: 3 });
});

client.on("interactionCreate", async interaction => {
  try {
    if (!authorized(interaction)) {
      return interaction.reply({
        content: "❌ You need **Administrator** or **Manage Server**.",
        ephemeral: true
      });
    }

    if (interaction.isChatInputCommand() &&
        interaction.commandName === "reset" &&
        interaction.options.getSubcommand() === "server") {

      const embed = new EmbedBuilder()
        .setTitle("⚠️ Server Reset Center")
        .setDescription(
          "**Dangerous operation.** Select everything you want to reset.\n\n" +
          "Nothing happens until you confirm the final prompt.\n\n" +
          "A pre-reset emergency snapshot will be saved first."
        );

      const row = new ActionRowBuilder().addComponents(makeMenu());

      const everything = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("reset_everything")
          .setLabel("Everything")
          .setEmoji("💥")
          .setStyle(ButtonStyle.Danger)
      );

      return interaction.reply({
        embeds: [embed],
        components: [row, everything],
        ephemeral: true
      });
    }

    if (interaction.isButton() &&
        (interaction.customId === "reset_everything")) {

      const options = ["channels", "roles", "emojis", "messages", "settings"];
      sessions.set(interaction.user.id, {
        guildId: interaction.guild.id,
        options,
        createdAt: Date.now()
      });

      return showConfirmation(interaction, options);
    }

    if (interaction.isStringSelectMenu() &&
        interaction.customId === "reset_options") {

      const options = interaction.values;

      sessions.set(interaction.user.id, {
        guildId: interaction.guild.id,
        options,
        createdAt: Date.now()
      });

      return showConfirmation(interaction, options);
    }

    if (interaction.isButton() && interaction.customId === "reset_cancel") {
      sessions.delete(interaction.user.id);
      return interaction.update({
        content: "❌ Reset cancelled.",
        embeds: [],
        components: []
      });
    }

    if (interaction.isButton() && interaction.customId === "reset_confirm") {
      const session = sessions.get(interaction.user.id);

      if (!session || session.guildId !== interaction.guild.id ||
          Date.now() - session.createdAt > 10 * 60 * 1000) {
        return interaction.update({
          content: "❌ This reset session expired. Run `/reset server` again.",
          embeds: [],
          components: []
        });
      }

      const modal = new ModalBuilder()
        .setCustomId("reset_final_modal")
        .setTitle("Final Server Reset Confirmation");

      const input = new TextInputBuilder()
        .setCustomId("reset_word")
        .setLabel("Type RESET to continue")
        .setPlaceholder("RESET")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(5);

      modal.addComponents(new ActionRowBuilder().addComponents(input));
      return interaction.showModal(modal);
    }

    if (interaction.isModalSubmit() &&
        interaction.customId === "reset_final_modal") {

      const session = sessions.get(interaction.user.id);
      const word = interaction.fields.getTextInputValue("reset_word");

      if (!session || session.guildId !== interaction.guild.id) {
        return interaction.reply({ content: "❌ Reset session expired.", ephemeral: true });
      }

      if (word !== "RESET") {
        return interaction.reply({
          content: "❌ Incorrect confirmation. Nothing was changed.",
          ephemeral: true
        });
      }

      sessions.delete(interaction.user.id);
      await interaction.deferReply({ ephemeral: true });

      let snapshotFile = null;
      try {
        snapshotFile = await snapshot(interaction.guild);
      } catch (e) {
        console.error("Snapshot failed:", e);
      }

      const results = await runReset(interaction.guild, session.options);

      const embed = new EmbedBuilder()
        .setTitle("✅ Server Reset Complete")
        .setDescription(
          `**Reset:**\n${session.options.map(labelFor).join("\n")}\n\n` +
          `**Results:**\n${resultText(results)}\n\n` +
          `**Emergency snapshot:** ${snapshotFile ? "Saved before reset." : "Could not be saved."}`
        )
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }
  } catch (error) {
    console.error(error);

    const content = `❌ Reset failed: ${error?.message || "Unknown error."}`;

    if (interaction.deferred || interaction.replied) {
      return interaction.editReply({ content, embeds: [], components: [] }).catch(() => {});
    }

    return interaction.reply({ content, ephemeral: true }).catch(() => {});
  }
});

async function showConfirmation(interaction, options) {
  const embed = new EmbedBuilder()
    .setTitle("🚨 Confirm Server Reset")
    .setDescription(
      "**THE FOLLOWING WILL BE CHANGED:**\n\n" +
      options.map(labelFor).join("\n") +
      "\n\n⚠️ This action is destructive.\n" +
      "The bot will create an emergency snapshot before proceeding.\n\n" +
      "You will have to type **RESET** in the final confirmation."
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("reset_confirm")
      .setLabel("Continue")
      .setEmoji("⚠️")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId("reset_cancel")
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Secondary)
  );

  return interaction.update({
    embeds: [embed],
    components: [row]
  });
}

client.login(TOKEN);
