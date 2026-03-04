import { connect } from 'cloudflare:sockets';

/**
 * This file handles reading emails from the verification mailbox to ensure proof of membership.
 */

export async function verifyEmail(emailPass, memberAddress) {
  /**
   * NJ DSA uses Migadu as its email provider.
   * Replace the hostname with the email provider that your chapter uses,
   * and make sure you have the right port number (typically either 143 or 993 for IMAP).
   */
  const socket = connect(
    {
      hostname: 'imap.migadu.com',
      port: 993,
    },
    { secureTransport: 'on', servername: 'imap.migadu.com' },
  );

  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  async function sendCommand(tag, cmd) {
    await writer.write(encoder.encode(`${tag} ${cmd}\r\n`));
    let fullResponse = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      fullResponse += decoder.decode(value);

      const lines = fullResponse.trimEnd().split('\r\n');
      const lastLine = lines[lines.length - 1];

      if (
        lastLine.startsWith(`${tag} OK`) ||
        lastLine.startsWith(`${tag} NO`) ||
        lastLine.startsWith(`${tag} BAD`)
      ) {
        break; // TERMINATE IMMEDIATELY
      }
    }

    return fullResponse;
  }

  try {
    await reader.read();

    const loginResp = await sendCommand(
      'a1',
      `LOGIN cnj.verify@dsanj.org ${emailPass}`,
    );
    if (loginResp.includes('a1 OK')) {
      await sendCommand('a2', 'SELECT INBOX');

      const searchResp = await sendCommand(
        'a3',
        `SEARCH FROM "noreply@dsausa.org" BODY "${memberAddress}" SUBJECT "Proof of Membership"`,
      );
      const matches = searchResp.split('\r\n')[0].split(' ').slice(2);

      const matchesStr = matches.join(',');
      const fetchBodyResp = await sendCommand(
        'a4',
        `FETCH ${matchesStr} (BODY.PEEK[1])`,
      );
      const possibleAddresses = fetchBodyResp
        .split(' ')
        .filter((str) => str.includes('@'));
      if (matches.length > 0 && possibleAddresses.includes(memberAddress)) {
        let exactMatches = [];
        possibleAddresses.forEach((addr, i) => {
          if (addr == memberAddress) exactMatches.push(matches[i]);
        });
        const exactMatchesStr = exactMatches.join(',');
        const moveResp = await sendCommand(
          'a5',
          `MOVE ${exactMatchesStr} "Trash"`,
        );
        console.log(moveResp);
        return { success: true };
      }
      return { success: false, error: 'No proof email found.' };
    } else {
      return { success: false, error: 'auth failed: ' + loginResp };
    }
  } catch (e) {
    return { success: false, error: 'System error: ' + e.message };
  } finally {
    await sendCommand('a4', 'LOGOUT');
    socket.close();
  }
}
