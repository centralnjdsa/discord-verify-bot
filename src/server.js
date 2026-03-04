/**
 * The core server that runs on a Cloudflare worker.
 */

import { AutoRouter } from 'itty-router';
import {
  InteractionResponseType,
  InteractionType,
  verifyKey,
} from 'discord-interactions';
import { HELLO_COMMAND, VERIFY_COMMAND } from './commands.js';
import { verifyEmail } from './cf-email.js';

class JsonResponse extends Response {
  constructor(body, init) {
    const jsonBody = JSON.stringify(body);
    init = init || {
      headers: {
        'content-type': 'application/json;charset=UTF-8',
      },
    };
    super(jsonBody, init);
  }
}

const router = AutoRouter();

/**
 * A simple :wave: hello page to verify the worker is working.
 */
router.get('/', (request, env) => {
  return new Response(`👋 ${env.DISCORD_APPLICATION_ID}`);
});

/**
 * Main route for all requests sent from Discord.  All incoming messages will
 * include a JSON payload described here:
 * https://discord.com/developers/docs/interactions/receiving-and-responding#interaction-object
 */
router.post('/', async (request, env, ctx) => {
  const { isValid, interaction } = await server.verifyDiscordRequest(
    request,
    env,
  );
  if (!isValid || !interaction) {
    return new Response('Bad request signature.', { status: 401 });
  }

  if (interaction.type === InteractionType.PING) {
    // The `PING` message is used during the initial webhook handshake, and is
    // required to configure the webhook in the developer portal.
    return new JsonResponse({
      type: InteractionResponseType.PONG,
    });
  }

  if (interaction.type === InteractionType.APPLICATION_COMMAND) {
    // Most user commands will come as `APPLICATION_COMMAND`.
    switch (interaction.data.name.toLowerCase()) {
      case HELLO_COMMAND.name.toLowerCase(): {
        return new JsonResponse({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: 'Hey there comrade!',
            flags: 1 << 6,
          },
        });
      }
      case VERIFY_COMMAND.name.toLowerCase(): {
        const email = interaction.data.options[0].value;
        const check = await verifyEmail(env.VERIFY_EMAIL_PASS, email);

        let response;
        if (check.success) {
          const initialResponse = new JsonResponse({
            type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              flags: 1 << 6,
            },
          });

          ctx.waitUntil(
            (async () => {
              const member = interaction.member;
              const guildID = interaction.guild_id;

              const roles = await handleRequestJson(
                env,
                `/guilds/${guildID}/roles`,
                'GET',
              );

              const addRoleID = roles.find((role) => role.name === 'Vetted').id;
              const removeRoleID = roles.find(
                (role) => role.name === 'Pre-Onboarding',
              ).id;

              const addRoleURL = `/guilds/${guildID}/members/${member.user.id}/roles/${addRoleID}`;
              const removeRoleURL = `/guilds/${guildID}/members/${member.user.id}/roles/${removeRoleID}`;

              await handleRequestJson(env, addRoleURL, 'PUT');
              await handleRequest(env, removeRoleURL, 'DELETE');

              const token = interaction.token;
              response =
                'Thank you for verifying. Welcome to the Central New Jersey DSA Discord!';
              await fetch(
                `https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${token}/messages/@original`,
                {
                  method: 'PATCH',
                  headers: {
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({
                    content: response,
                  }),
                },
              );
            })(),
          );

          return initialResponse;
        } else {
          response = `We're sorry, we were unable to verify you. Reason: ${check.error}\n\nPlease notify a member of the Steering Committee in the event of any errors.`;
          return new JsonResponse({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              content: response,
              flags: 1 << 6,
            },
          });
        }
      }
      default:
        return new JsonResponse({ error: 'Unknown Type' }, { status: 400 });
    }
  }

  console.error('Unknown Type');
  return new JsonResponse({ error: 'Unknown Type' }, { status: 400 });
});
router.all('*', () => new Response('Not Found.', { status: 404 }));

async function verifyDiscordRequest(request, env) {
  const signature = request.headers.get('x-signature-ed25519');
  const timestamp = request.headers.get('x-signature-timestamp');
  const body = await request.text();
  const isValidRequest =
    signature &&
    timestamp &&
    (await verifyKey(body, signature, timestamp, env.DISCORD_PUBLIC_KEY));
  if (!isValidRequest) {
    return { isValid: false };
  }

  return { interaction: JSON.parse(body), isValid: true };
}

async function handleRequest(env, url, method) {
  try {
    const fullUrl = `https://discord.com/api/v10${url}`;
    const response = await fetch(fullUrl, {
      method: method,
      headers: {
        Authorization: `Bot ${env.DISCORD_TOKEN}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Response status: ${response.status}`);
    }

    const result = await response.json();
    return result;
  } catch (err) {
    console.error(err.message);
  }
}

async function handleRequestJson(env, url, method) {
  try {
    const fullUrl = `https://discord.com/api/v10${url}`;
    const response = await fetch(fullUrl, {
      method: method,
      headers: {
        Authorization: `Bot ${env.DISCORD_TOKEN}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Response status: ${response.status}`);
    }

    const result = await response.json();
    return result;
  } catch (err) {
    console.error(err.message);
  }
}

const server = {
  verifyDiscordRequest,
  fetch: router.fetch,
};

export default server;
