/**
 * Share command metadata from a common spot to be used for both runtime
 * and registration.
 */

export const HELLO_COMMAND = {
  name: 'hello',
  description: 'Say hello!',
};

export const VERIFY_COMMAND = {
  name: 'verify',
  description: 'Verify that an email belongs to a DSA member.',
  options: [
    {
      name: 'email',
      description: 'The email you used to register for DSA membership.',
      type: 3,
      required: true,
    },
  ],
};
