const DEFAULT_DISCORD_APP_ID = "1513981874949587176";

export const DISCORD_APP_ID =
  process.env.NEXT_PUBLIC_DISCORD_APP_ID ?? DEFAULT_DISCORD_APP_ID;

// Discord-provided install link; opens the Add App flow for servers and users.
export const DISCORD_BOT_INSTALL_URL =
  `https://discord.com/oauth2/authorize?client_id=${DISCORD_APP_ID}`;
