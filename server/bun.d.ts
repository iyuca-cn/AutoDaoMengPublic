declare const Bun: {
  serve(options: {
    port: number;
    fetch(request: Request): Response | Promise<Response>;
  }): unknown;
  spawn(command: string[], options?: {
    cwd?: string;
    stdout?: "ignore" | "pipe";
    stderr?: "ignore" | "pipe";
  }): {
    kill(signal?: string | number): void;
  };
};
