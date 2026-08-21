import { DEBUG, LOG_PREFIX } from '../config.ts';

/**
 * Logging that compiles away.
 *
 * `DEBUG` is a build-time constant, so in a production build every `log.debug`
 * call site collapses to dead code and is removed entirely — the bundle carries
 * neither the call nor the message.
 *
 * Never log a credential. Only a mask (`sk-...wxyz`) may ever appear.
 */

type Fields = Record<string, unknown>;

const emit = (level: 'log' | 'warn' | 'error', message: string, fields?: Fields): void => {
  // eslint-disable-next-line no-console
  if (fields) console[level](`${LOG_PREFIX} ${message}`, fields);
  // eslint-disable-next-line no-console
  else console[level](`${LOG_PREFIX} ${message}`);
};

export const log = {
  debug(message: string, fields?: Fields): void {
    if (DEBUG) emit('log', message, fields);
  },
  info(message: string, fields?: Fields): void {
    if (DEBUG) emit('log', message, fields);
  },
  warn(message: string, fields?: Fields): void {
    emit('warn', message, fields);
  },
  error(message: string, fields?: Fields): void {
    emit('error', message, fields);
  },
};
