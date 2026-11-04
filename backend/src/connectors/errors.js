/**
 * A store couldn't be connected with what the person typed: the message says
 * why in words they can act on ("That isn't a WooCommerce site's address"),
 * and goes back to them as is. It never repeats a secret they typed.
 */
export class ConnectError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConnectError';
  }
}
