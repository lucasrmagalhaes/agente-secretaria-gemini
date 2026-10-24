export interface Logger {
  info(message: string): void;
  error(message: string): void;
}

export const stdoutLogger: Logger = {
  info(message) {
    console.log(message);
  },
  error(message) {
    console.error(message);
  },
};

/** Stdout belongs to the MCP protocol. Logs from the server go to stderr. */
export const stderrLogger: Logger = {
  info(message) {
    console.error(message);
  },
  error(message) {
    console.error(message);
  },
};

export const silentLogger: Logger = {
  info() {},
  error() {},
};
